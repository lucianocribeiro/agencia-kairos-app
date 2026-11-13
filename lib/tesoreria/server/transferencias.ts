import "server-only";

import { randomUUID } from "node:crypto";

import { getAirtableClient, type Fields } from "@/lib/airtable/client";
import { eq } from "@/lib/airtable/formula";
import { WrittenRecordMissingError } from "@/lib/airtable/integrity";
import { invalidFieldIds } from "@/lib/airtable/payload";
import { TABLES } from "@/lib/airtable/schema";
import type { RawValues } from "@/lib/abm/fields";
import { Compensation, previousOf, rollbackAndLog, WRITE_MESSAGES } from "@/lib/abm/server/compensation";
import { injectFault } from "@/lib/abm/server/fault-injection";
import type { ServiceResult } from "@/lib/abm/types";
import { TESORERIA_MESSAGES, TIPO_TRANSFERENCIA, validarMovimiento, type MovimientoDatos, type TesoreriaCtx } from "../rules";
import { compact, loadTesoreriaCtx, parseInput, READ_FIELDS, toFields, toMovimiento, type MovimientoGuardado } from "./movimientos";

/**
 * Transferencias entre cuentas propias: 2 registros (Pago en origen, Cobranza en
 * destino) con el tipo «Transferencia entre cuentas propias», Suma a resultados N y el
 * mismo ID en «Transferencia». Se crean, editan y borran juntos, con compensación
 * (patrón de Fase 1) y verificación posterior fail-closed.
 */

const T = TABLES.tesoreria;
const F = T.fields;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
export const TRANSFERENCIA_ID_RE = /^TR-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const TRANSFERENCIA_MESSAGES = {
  noEncontrada: "No encontramos la transferencia. Puede que la hayan borrado.",
  incompleta: "La transferencia no tiene sus 2 registros. Avisá a un administrador.",
  sinTipo: `Falta el tipo de operación «${TIPO_TRANSFERENCIA}» en Maestros.`,
  borradoRevertido: "No pudimos borrar la transferencia. Se restauró el registro borrado (con otro N°); probá de nuevo.",
  formato: "Los datos no tienen el formato esperado.",
  error: "Ocurrió un error. Probá de nuevo.",
  ...WRITE_MESSAGES,
} as const;

export const TRANSFERENCIA_INPUT_KEYS = ["cuentaOrigen", "cuentaDestino", "importe", "fecha", "tipoCambio", "descripcion"] as const;

const fail = (status: 400 | 404 | 409 | 500 | 503, error: string): ServiceResult<never> => ({ ok: false, status, error });

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
  // cuentas: validadas como links; el resto, con el mismo parser que los movimientos.
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

/** Los 2 movimientos de una transferencia, validados (misma moneda, cuentas distintas, TC en USD). */
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

/** Registros con ese ID de transferencia (filtro en Airtable y otra vez en código). */
async function leerPar(id: string): Promise<MovimientoGuardado[]> {
  const records = await getAirtableClient().list(T.id, { fields: READ_FIELDS, filterByFormula: eq(F.transferencia, id) });
  return records.map(toMovimiento).filter((m) => m.transferencia === id);
}

function payloadOk(fields: Fields[]): boolean {
  const bad = fields.flatMap((f) => invalidFieldIds(T.id, f));
  if (bad.length === 0) return true;
  console.error("[tesoreria] Payload inválido (bug del servidor)", { campos: [...new Set(bad)] });
  return false;
}

/** Verificación posterior: exactamente los 2 registros esperados con ese ID. Si falta uno → lanza. */
async function verificarPar(id: string, esperados: readonly string[]): Promise<void> {
  const par = await leerPar(id);
  for (const e of esperados) if (!par.some((m) => m.id === e)) throw new WrittenRecordMissingError(e);
  if (par.length !== 2) throw new Error("transferencia con más de 2 registros");
}

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

  const tx = new Compensation();
  const ids: string[] = [];
  try {
    ids.push(await tx.create(T.id, pagoFields));
    injectFault("transferencia:crear:2");
    ids.push(await tx.create(T.id, cobranzaFields));
  } catch {
    return (await rollbackAndLog(tx, `transferencia ${id}`)) ? fail(503, TRANSFERENCIA_MESSAGES.revertido) : fail(500, TRANSFERENCIA_MESSAGES.incompleto);
  }
  try {
    await verificarPar(id, ids);
  } catch {
    return (await rollbackAndLog(tx, `transferencia ${id} (verificación)`)) ? fail(503, TRANSFERENCIA_MESSAGES.noVerificado) : fail(500, TRANSFERENCIA_MESSAGES.incompleto);
  }
  return { ok: true, data: { transferencia: id, ids } };
}

/** Lee el par y lo valida (exactamente un Pago y una Cobranza). */
async function parExistente(id: string): Promise<{ pago: MovimientoGuardado; cobranza: MovimientoGuardado } | ServiceResult<never>> {
  if (!TRANSFERENCIA_ID_RE.test(id)) return fail(404, TRANSFERENCIA_MESSAGES.noEncontrada);
  const par = await leerPar(id);
  if (par.length === 0) return fail(404, TRANSFERENCIA_MESSAGES.noEncontrada);
  const pago = par.find((m) => m.movimiento === "Pago");
  const cobranza = par.find((m) => m.movimiento === "Cobranza");
  if (par.length !== 2 || !pago || !cobranza) return fail(409, TRANSFERENCIA_MESSAGES.incompleta);
  return { pago, cobranza };
}

/** Edita los 2 registros juntos. Si una escritura falla, se restauran los 2 desde la foto previa. */
export async function updateTransferencia(id: string, raw: RawValues): Promise<ServiceResult<{ transferencia: string }>> {
  const existing = await parExistente(id);
  if ("ok" in existing) return existing;
  const input = parseTransferencia(raw);
  if ("error" in input) return fail(400, input.error);
  const t: TransferenciaDatos = {
    cuentaOrigen: existing.pago.cuenta,
    cuentaDestino: existing.cobranza.cuenta,
    importe: existing.pago.importe,
    fecha: existing.pago.fecha,
    tipoCambio: existing.pago.tipoCambio,
    descripcion: existing.pago.descripcion,
    ...input,
  };
  const ctx = await loadTesoreriaCtx();
  const par = armarPar(t, ctx, id);
  if ("error" in par) return fail(400, par.error);
  const cuenta = (c: string | null) => ctx.cuentas.find((x) => x.id === c);
  const pagoFields = toFields(par.pago, cuenta(par.pago.cuenta));
  const cobranzaFields = toFields(par.cobranza, cuenta(par.cobranza.cuenta));
  if (!payloadOk([pagoFields, cobranzaFields])) return fail(500, TRANSFERENCIA_MESSAGES.error);
  const before = (m: MovimientoGuardado, fields: Fields) => previousOf(fields, toFields(m, cuenta(m.cuenta)));

  const tx = new Compensation();
  try {
    await tx.update(T.id, [{ id: existing.pago.id, fields: pagoFields, previous: before(existing.pago, pagoFields) }]);
    injectFault("transferencia:editar:2");
    await tx.update(T.id, [{ id: existing.cobranza.id, fields: cobranzaFields, previous: before(existing.cobranza, cobranzaFields) }]);
  } catch {
    return (await rollbackAndLog(tx, `transferencia ${id} (edición)`)) ? fail(503, TRANSFERENCIA_MESSAGES.revertido) : fail(500, TRANSFERENCIA_MESSAGES.incompleto);
  }
  try {
    await verificarPar(id, [existing.pago.id, existing.cobranza.id]);
  } catch {
    return (await rollbackAndLog(tx, `transferencia ${id} (verificación de la edición)`)) ? fail(503, TRANSFERENCIA_MESSAGES.noVerificado) : fail(500, TRANSFERENCIA_MESSAGES.incompleto);
  }
  return { ok: true, data: { transferencia: id } };
}

/**
 * Borra los 2 registros. Si el segundo borrado falla, el primero se vuelve a crear
 * desde la foto (mismos valores y mismo ID de transferencia; el N° es nuevo) → 503.
 * Si eso también falla → 500 «quedó incompleto» (se loguean los IDs).
 */
export async function deleteTransferencia(id: string): Promise<ServiceResult<{ transferencia: string; ids: string[] }>> {
  const existing = await parExistente(id);
  if ("ok" in existing) return existing;
  const ctx = await loadTesoreriaCtx();
  const snapshot = compact(toFields(existing.pago, ctx.cuentas.find((c) => c.id === existing.pago.cuenta)));
  const client = getAirtableClient();
  await client.delete(T.id, [existing.pago.id]);
  try {
    injectFault("transferencia:borrar:2");
    await client.delete(T.id, [existing.cobranza.id]);
  } catch {
    try {
      const [restored] = await client.create(T.id, [snapshot], { returnFields: [] });
      console.error("[tesoreria] Borrado de transferencia revertido", { transferencia: id, borrado: existing.pago.id, restaurado: restored.id });
      return fail(503, TRANSFERENCIA_MESSAGES.borradoRevertido);
    } catch {
      console.error("[tesoreria] TRANSFERENCIA INCOMPLETA: falló el borrado y la restauración", { transferencia: id, borrado: existing.pago.id, queda: existing.cobranza.id });
      return fail(500, TRANSFERENCIA_MESSAGES.incompleto);
    }
  }
  return { ok: true, data: { transferencia: id, ids: [existing.pago.id, existing.cobranza.id] } };
}
