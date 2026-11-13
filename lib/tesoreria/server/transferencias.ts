import "server-only";

import { randomUUID } from "node:crypto";

import { getAirtableClient, type Fields } from "@/lib/airtable/client";
import { eq } from "@/lib/airtable/formula";
import { invalidFieldIds } from "@/lib/airtable/payload";
import { TABLES } from "@/lib/airtable/schema";
import type { RawValues } from "@/lib/abm/fields";
import { WRITE_MESSAGES } from "@/lib/abm/server/compensation";
import { injectFault } from "@/lib/abm/server/fault-injection";
import type { ServiceResult } from "@/lib/abm/types";
import { patasConsistentes, TESORERIA_MESSAGES, TIPO_TRANSFERENCIA, validarMovimiento, type MovimientoDatos, type TesoreriaCtx } from "../rules";
import { compact, loadTesoreriaCtx, parseInput, READ_FIELDS, toFields, toMovimiento, type MovimientoGuardado } from "./movimientos";

/**
 * Transferencias entre cuentas propias: 2 registros (Pago en origen, Cobranza en
 * destino) con el tipo «Transferencia entre cuentas propias», Suma a resultados N y el
 * mismo ID nuevo en «Transferencia».
 *
 * Todo se reconcilia POR ID DE TRANSFERENCIA: el ID es nuevo y único, así que todo
 * registro que lo tenga pertenece a esa transferencia. Eso cubre las escrituras
 * ambiguas de Airtable (aplicadas pero respondidas con error): después de cualquier
 * error se relee por ID y se deja la base en un estado conocido (sin registros, o el
 * par completo con los valores esperados). Nunca se responde 2xx con el par
 * incompleto o con valores distintos de los esperados.
 */

const T = TABLES.tesoreria;
const F = T.fields;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
export const TRANSFERENCIA_ID_RE = /^TR-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const TRANSFERENCIA_MESSAGES = {
  noEncontrada: "No encontramos la transferencia. Puede que la hayan borrado.",
  incompleta: "La transferencia está incompleta (no tiene un Pago y una Cobranza). Borrala y volvé a cargarla.",
  cambio: "La transferencia cambió mientras la editabas. Recargá y probá de nuevo.",
  sinTipo: `Falta el tipo de operación «${TIPO_TRANSFERENCIA}» en Maestros.`,
  formato: "Los datos no tienen el formato esperado.",
  error: "Ocurrió un error. Probá de nuevo.",
  ...WRITE_MESSAGES,
} as const;

export const TRANSFERENCIA_INPUT_KEYS = ["cuentaOrigen", "cuentaDestino", "importe", "fecha", "tipoCambio", "descripcion"] as const;

const fail = (status: 400 | 404 | 409 | 500 | 503, error: string): ServiceResult<never> => ({ ok: false, status, error });
const log = (msg: string, data: Record<string, unknown>) => console.error(`[tesoreria] ${msg}`, data);

export interface TransferenciaDatos {
  cuentaOrigen: string | null;
  cuentaDestino: string | null;
  importe: number | null;
  fecha: string | null;
  tipoCambio: number | null;
  descripcion: string;
}

function parseTransferencia(raw: RawValues): Partial<TransferenciaDatos> | { error: string } {
  const out: Partial<TransferenciaDatos> = {};
  for (const key of ["cuentaOrigen", "cuentaDestino"] as const) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (typeof v !== "string" || (v.trim() !== "" && !RECORD_ID_RE.test(v.trim()))) return { error: TRANSFERENCIA_MESSAGES.formato };
    out[key] = v.trim() || null;
  }
  const rest = parseInput(raw, ["importe", "fecha", "tipoCambio", "descripcion"]);
  if ("error" in rest) return rest;
  return { ...out, ...(rest as Partial<TransferenciaDatos>) };
}

/** Los 2 movimientos de una transferencia, validados (misma moneda, cuentas distintas, TC en USD, fecha real). */
function armarPar(t: TransferenciaDatos, ctx: TesoreriaCtx, id: string): { pago: MovimientoDatos; cobranza: MovimientoDatos } | { error: string } {
  const tipo = ctx.tipos.find((x) => x.nombre === TIPO_TRANSFERENCIA);
  if (!tipo) return { error: TRANSFERENCIA_MESSAGES.sinTipo };
  const origen = ctx.cuentas.find((c) => c.id === t.cuentaOrigen);
  const destino = ctx.cuentas.find((c) => c.id === t.cuentaDestino);
  if (t.cuentaOrigen && t.cuentaOrigen === t.cuentaDestino) return { error: TESORERIA_MESSAGES.mismaCuenta };
  if (origen && destino && origen.moneda !== destino.moneda) return { error: TESORERIA_MESSAGES.mismaMoneda };
  const base = {
    fecha: t.fecha,
    importe: t.importe,
    tipoOperacion: tipo.id,
    cliente: null,
    proveedor: null,
    sumaResultados: "N",
    categoria: null,
    socio: null,
    tipoCambio: origen?.moneda === "USD" ? t.tipoCambio : null,
    descripcion: t.descripcion,
    transferencia: id,
  };
  const pago: MovimientoDatos = { ...base, cuenta: t.cuentaOrigen, movimiento: "Pago" };
  const cobranza: MovimientoDatos = { ...base, cuenta: t.cuentaDestino, movimiento: "Cobranza" };
  for (const m of [pago, cobranza]) {
    const error = validarMovimiento(m, ctx, { esTransferencia: true });
    if (error) return { error };
  }
  return { pago, cobranza };
}

/** Todos los registros con ese ID de transferencia (fórmula escapada y otra vez en código). */
export async function leerPorTransferencia(id: string): Promise<MovimientoGuardado[]> {
  const records = await getAirtableClient().list(T.id, { fields: READ_FIELDS, filterByFormula: eq(F.transferencia, id) });
  return records.map(toMovimiento).filter((m) => m.transferencia === id);
}

const KEYS: (keyof MovimientoDatos)[] = [
  "fecha",
  "cuenta",
  "movimiento",
  "importe",
  "tipoOperacion",
  "cliente",
  "proveedor",
  "sumaResultados",
  "categoria",
  "socio",
  "tipoCambio",
  "descripcion",
  "transferencia",
];

/** ¿El registro tiene exactamente los valores esperados en todos los campos escribibles? */
export function mismosValores(m: MovimientoDatos, expected: MovimientoDatos): boolean {
  return KEYS.every((k) => (k === "descripcion" ? (m[k] || "") === (expected[k] || "") : (m[k] ?? null) === (expected[k] ?? null)));
}

/**
 * Par completo y con los valores esperados (un Pago y una Cobranza, nada más). Con
 * `ids`, además tienen que ser exactamente esos registros.
 */
export function parCorrecto(
  par: readonly MovimientoGuardado[],
  pago: MovimientoDatos,
  cobranza: MovimientoDatos,
  ids?: { pago: string; cobranza: string },
): boolean {
  if (par.length !== 2) return false;
  const p = par.find((m) => m.movimiento === "Pago");
  const c = par.find((m) => m.movimiento === "Cobranza");
  if (!p || !c || !mismosValores(p, pago) || !mismosValores(c, cobranza)) return false;
  return !ids || (p.id === ids.pago && c.id === ids.cobranza);
}

function payloadOk(fields: Fields[]): boolean {
  const bad = fields.flatMap((f) => invalidFieldIds(T.id, f));
  if (bad.length === 0) return true;
  log("Payload inválido (bug del servidor)", { campos: [...new Set(bad)] });
  return false;
}

/**
 * Deja la base sin ningún registro con ese ID: relee, borra todo lo que encuentre en un
 * pedido y relee para confirmar. true = 0 registros (verificado).
 */
async function limpiarTransferencia(id: string, motivo: string): Promise<boolean> {
  let ids: string[] = [];
  try {
    ids = (await leerPorTransferencia(id)).map((m) => m.id);
    if (ids.length > 0) {
      try {
        await getAirtableClient().delete(T.id, ids);
      } catch {
        // puede haberse aplicado igual: lo decide la relectura
      }
    }
    const quedan = await leerPorTransferencia(id);
    if (quedan.length === 0) {
      log(`${motivo}: transferencia deshecha`, { transferencia: id, ids });
      return true;
    }
    log(`${motivo}: TRANSFERENCIA INCOMPLETA, quedaron registros`, { transferencia: id, ids: quedan.map((m) => m.id) });
    return false;
  } catch {
    log(`${motivo}: TRANSFERENCIA INCOMPLETA, no se pudo verificar la limpieza`, { transferencia: id, ids });
    return false;
  }
}

/**
 * Alta: los 2 registros en UN pedido de create (nunca se reintenta). Ante cualquier
 * error, timeout o verificación fallida se borra todo lo que tenga el ID → 503 (o 500 si
 * no se puede confirmar que quedó en 0). Éxito solo si la relectura encuentra
 * exactamente los 2 registros con todos los valores esperados.
 */
export async function createTransferencia(raw: RawValues): Promise<ServiceResult<{ transferencia: string; ids: string[] }>> {
  const input = parseTransferencia(raw);
  if ("error" in input) return fail(400, input.error);
  const t: TransferenciaDatos = { cuentaOrigen: null, cuentaDestino: null, importe: null, fecha: null, tipoCambio: null, descripcion: "", ...input };
  const ctx = await loadTesoreriaCtx();
  const id = `TR-${randomUUID()}`;
  const par = armarPar(t, ctx, id);
  if ("error" in par) return fail(400, par.error);
  const cuenta = (c: string | null) => ctx.cuentas.find((x) => x.id === c);
  const pagoFields = compact(toFields(par.pago, cuenta(par.pago.cuenta)));
  const cobranzaFields = compact(toFields(par.cobranza, cuenta(par.cobranza.cuenta)));
  if (!payloadOk([pagoFields, cobranzaFields])) return fail(500, TRANSFERENCIA_MESSAGES.error);

  try {
    const created = await getAirtableClient().create(T.id, [pagoFields, cobranzaFields], { returnFields: [] });
    injectFault("transferencia:crear:respuesta"); // escritura aplicada pero respondida con error
    // Con la respuesta OK, la verificación exige exactamente los registros creados (en orden: Pago, Cobranza).
    const esperados = created.length === 2 ? { pago: created[0].id, cobranza: created[1].id } : null;
    if (!esperados) throw new Error("respuesta del create sin los 2 registros");
    injectFault("transferencia:crear:verificar");
    const leidos = await leerPorTransferencia(id);
    if (!parCorrecto(leidos, par.pago, par.cobranza, esperados)) throw new Error("verificación: el par no coincide");
    return { ok: true, data: { transferencia: id, ids: leidos.map((m) => m.id) } };
  } catch {
    return (await limpiarTransferencia(id, "alta")) ? fail(503, TRANSFERENCIA_MESSAGES.revertido) : fail(500, TRANSFERENCIA_MESSAGES.incompleto);
  }
}

/** Par existente y completo (un Pago y una Cobranza). */
async function parCompleto(id: string): Promise<{ pago: MovimientoGuardado; cobranza: MovimientoGuardado } | ServiceResult<never>> {
  if (!TRANSFERENCIA_ID_RE.test(id)) return fail(404, TRANSFERENCIA_MESSAGES.noEncontrada);
  const par = await leerPorTransferencia(id);
  if (par.length === 0) return fail(404, TRANSFERENCIA_MESSAGES.noEncontrada);
  const pago = par.find((m) => m.movimiento === "Pago");
  const cobranza = par.find((m) => m.movimiento === "Cobranza");
  if (par.length !== 2 || !pago || !cobranza) return fail(409, TRANSFERENCIA_MESSAGES.incompleta);
  return { pago, cobranza };
}

export const EDICION_MESSAGES = {
  concurrente: "Otra persona editó esta transferencia al mismo tiempo. Recargá para ver los datos actuales.",
} as const;

type Estado = "nuestra" | "original" | "ajena";

/**
 * Clasifica una pata después de la edición: «nuestra» = tiene lo que este pedido quiso
 * escribir; «original» = igual a la foto; «ajena» = cualquier otra cosa (otra persona la
 * cambió, o no está). Si lo nuevo y la foto son iguales, cuenta como «nuestra».
 */
function clasificar(leida: MovimientoGuardado | undefined, id: string, nuestra: MovimientoDatos, original: MovimientoDatos): Estado {
  if (!leida || leida.id !== id) return "ajena";
  if (mismosValores(leida, nuestra)) return "nuestra";
  if (mismosValores(leida, original)) return "original";
  return "ajena";
}

/**
 * Edición: foto de los 2 registros; justo antes de escribir se releen y se comparan con
 * la foto (cualquier diferencia → 409 sin escribir). Los 2 se actualizan en UN pedido y
 * se verifican (valores e IDs). Si algo falla, se releen y se clasifica cada pata
 * («nuestra» / «original» / «ajena») y se deshace SOLO lo propio:
 * - las 2 nuestras → 200 (la verificación había fallado de forma transitoria);
 * - las 2 originales → el update no se aplicó → 503, sin escribir;
 * - nuestras + originales (aplicado a medias) → se restauran solo las nuestras a la foto
 *   (un pedido) y se verifica → 503; sin verificar → 500;
 * - alguna ajena → no se escribe nada: si las patas forman un par consistente → 409
 *   (otra persona editó); si no → 500 (la red de seguridad lo marca en la lista).
 * Nunca se restaura una pata ajena. Riesgo residual en AGENTS.md (no hay compare-and-swap).
 */
export async function updateTransferencia(id: string, raw: RawValues): Promise<ServiceResult<{ transferencia: string }>> {
  const foto = await parCompleto(id);
  if ("ok" in foto) return foto;
  const input = parseTransferencia(raw);
  if ("error" in input) return fail(400, input.error);
  const t: TransferenciaDatos = {
    cuentaOrigen: foto.pago.cuenta,
    cuentaDestino: foto.cobranza.cuenta,
    importe: foto.pago.importe,
    fecha: foto.pago.fecha,
    tipoCambio: foto.pago.tipoCambio,
    descripcion: foto.pago.descripcion,
    ...input,
  };
  const ctx = await loadTesoreriaCtx();
  const par = armarPar(t, ctx, id);
  if ("error" in par) return fail(400, par.error);
  const cuenta = (c: string | null) => ctx.cuentas.find((x) => x.id === c);
  const nuevos = { pago: toFields(par.pago, cuenta(par.pago.cuenta)), cobranza: toFields(par.cobranza, cuenta(par.cobranza.cuenta)) };
  const anteriores = { pago: toFields(foto.pago, cuenta(foto.pago.cuenta)), cobranza: toFields(foto.cobranza, cuenta(foto.cobranza.cuenta)) };
  if (!payloadOk([nuevos.pago, nuevos.cobranza, anteriores.pago, anteriores.cobranza])) return fail(500, TRANSFERENCIA_MESSAGES.error);
  const ids = { pago: foto.pago.id, cobranza: foto.cobranza.id };

  // Cambio concurrente: se relee justo antes de escribir.
  const ahora = await leerPorTransferencia(id);
  if (!parCorrecto(ahora, foto.pago, foto.cobranza, ids)) return fail(409, TRANSFERENCIA_MESSAGES.cambio);

  try {
    await getAirtableClient().update(
      T.id,
      [
        { id: ids.pago, fields: nuevos.pago },
        { id: ids.cobranza, fields: nuevos.cobranza },
      ],
      { returnFields: [] },
    );
    injectFault("transferencia:editar:verificar");
    if (parCorrecto(await leerPorTransferencia(id), par.pago, par.cobranza, ids)) return { ok: true, data: { transferencia: id } };
  } catch {
    // se resuelve abajo, releyendo y clasificando
  }
  return reconciliarEdicion(id, ids, par, foto, anteriores, ctx);
}

async function reconciliarEdicion(
  id: string,
  ids: { pago: string; cobranza: string },
  nuevo: { pago: MovimientoDatos; cobranza: MovimientoDatos },
  foto: { pago: MovimientoGuardado; cobranza: MovimientoGuardado },
  anteriores: { pago: Fields; cobranza: Fields },
  ctx: TesoreriaCtx,
): Promise<ServiceResult<{ transferencia: string }>> {
  let leidos: MovimientoGuardado[];
  try {
    leidos = await leerPorTransferencia(id);
  } catch {
    log("TRANSFERENCIA INCOMPLETA: no se pudo releer después de la edición", { transferencia: id, ids: [ids.pago, ids.cobranza] });
    return fail(500, TRANSFERENCIA_MESSAGES.incompleto);
  }
  const pago = leidos.find((m) => m.id === ids.pago);
  const cobranza = leidos.find((m) => m.id === ids.cobranza);
  const estado = { pago: clasificar(pago, ids.pago, nuevo.pago, foto.pago), cobranza: clasificar(cobranza, ids.cobranza, nuevo.cobranza, foto.cobranza) };
  const estados = [estado.pago, estado.cobranza];

  if (estados.every((e) => e === "nuestra") && leidos.length === 2) return { ok: true, data: { transferencia: id } };
  if (estados.every((e) => e === "original") && leidos.length === 2) {
    log("Edición de transferencia no aplicada", { transferencia: id, ids: [ids.pago, ids.cobranza] });
    return fail(503, TRANSFERENCIA_MESSAGES.revertido);
  }
  if (estados.includes("ajena") || leidos.length !== 2) {
    // Otra persona cambió algo: no se escribe nada.
    const monedaDe = (c: string | null) => ctx.cuentas.find((x) => x.id === c)?.moneda;
    const consistente = !!pago && !!cobranza && leidos.length === 2 && patasConsistentes(pago, cobranza, monedaDe);
    log("Edición de transferencia en conflicto con otra", { transferencia: id, ids: [ids.pago, ids.cobranza], estado, consistente });
    return consistente ? fail(409, EDICION_MESSAGES.concurrente) : fail(500, TRANSFERENCIA_MESSAGES.incompleto);
  }

  // Aplicado a medias: se restauran solo las patas nuestras.
  const restaurar = (["pago", "cobranza"] as const).filter((k) => estado[k] === "nuestra").map((k) => ({ id: ids[k], fields: anteriores[k] }));
  try {
    await getAirtableClient().update(T.id, restaurar, { returnFields: [] });
  } catch {
    // lo decide la relectura
  }
  try {
    if (parCorrecto(await leerPorTransferencia(id), foto.pago, foto.cobranza, ids)) {
      log("Edición de transferencia aplicada a medias: revertida", { transferencia: id, ids: restaurar.map((r) => r.id) });
      return fail(503, TRANSFERENCIA_MESSAGES.revertido);
    }
  } catch {
    // cae al log de abajo
  }
  log("TRANSFERENCIA INCOMPLETA: no se pudo verificar la restauración", { transferencia: id, ids: restaurar.map((r) => r.id) });
  return fail(500, TRANSFERENCIA_MESSAGES.incompleto);
}

/**
 * Borrado: todo lo que tenga el ID (también un par incompleto) en UN pedido; después
 * se relee por ID. 0 → 200 (aunque el pedido haya respondido con error). Si quedan, se
 * reintenta borrar exactamente esos una vez (borrar es idempotente) y se relee: 0 → 200;
 * si siguen → 500 con los IDs en el log. Nunca se recrean registros.
 */
export async function deleteTransferencia(id: string): Promise<ServiceResult<{ transferencia: string; ids: string[] }>> {
  if (!TRANSFERENCIA_ID_RE.test(id)) return fail(404, TRANSFERENCIA_MESSAGES.noEncontrada);
  const antes = await leerPorTransferencia(id);
  if (antes.length === 0) return fail(404, TRANSFERENCIA_MESSAGES.noEncontrada);
  const ids = antes.map((m) => m.id);
  const client = getAirtableClient();

  const intentar = async (targets: string[]) => {
    try {
      const deleted = await client.delete(T.id, targets);
      injectFault("transferencia:borrar:respuesta"); // aplicado pero respondido con error
      const faltan = targets.filter((x) => !deleted.includes(x));
      if (faltan.length > 0) log("Borrado de transferencia: Airtable no confirmó todos", { transferencia: id, ids: faltan });
    } catch {
      // puede haberse aplicado: lo decide la relectura
    }
  };
  const quedan = async (): Promise<string[] | null> => {
    try {
      return (await leerPorTransferencia(id)).map((m) => m.id);
    } catch {
      return null;
    }
  };

  await intentar(ids);
  let resto = await quedan();
  if (resto === null || resto.length > 0) {
    await intentar(resto ?? ids);
    resto = await quedan();
  }
  if (resto !== null && resto.length === 0) return { ok: true, data: { transferencia: id, ids } };
  log("TRANSFERENCIA INCOMPLETA: no se pudo borrar todo", { transferencia: id, ids: resto ?? ids, relectura: resto ? "ok" : "fallida" });
  return fail(500, TRANSFERENCIA_MESSAGES.incompleto);
}
