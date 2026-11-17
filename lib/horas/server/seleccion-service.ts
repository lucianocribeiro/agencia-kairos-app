import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { or, recordIdIs } from "@/lib/airtable/formula";
import { TABLES } from "@/lib/airtable/schema";
import type { ServiceResult } from "@/lib/abm/types";
import { invalidFieldIds } from "@/lib/airtable/payload";
import { Compensation, rollbackAndLog, WRITE_MESSAGES } from "@/lib/abm/server/compensation";
import { injectFault } from "@/lib/abm/server/fault-injection";
import { ESTADO_MESSAGES, isEstadoFacturacion, type EstadoFacturacion } from "../estado";
import { PARAM_ALICUOTA, parseAlicuota, PROFORMA_MESSAGES, type HoraP, type Moneda } from "@/lib/proforma/proforma";
import { HORA_FIELDS, PROYECTO_FIELDS } from "@/lib/proforma/server/service";
import { vistaToSheet } from "@/lib/reportes/excel";
import { writeXlsx } from "@/lib/xlsx/write";
import { calcularSeleccion, nombreArchivoSeleccion, SELECCION_MAX, SELECCION_MESSAGES, vistaSeleccion, type SeleccionData } from "../seleccion";

/**
 * Selección de horas (Admin, CC-F4-05). Recibe solo IDs de Horas: todo lo demás (horas,
 * proyecto, valor hora, moneda, alícuota) se relee de Airtable en cada request. Solo lee.
 */

const H = TABLES.horas.fields;
const P = TABLES.proyectos.fields;
const PA = TABLES.parametros.fields;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
/** IDs por lectura (la fórmula OR(RECORD_ID() = …) no crece sin límite). */
const LOTE = 100;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const first = (v: unknown): string | null => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const moneda = (x: unknown): Moneda | null => (x === "ARS" || x === "USD" ? x : null);
const fail = (status: 400 | 409, error: string): ServiceResult<never> => ({ ok: false, status, error });

/** Body `{ ids: string[] }` → IDs únicos, o el error (400). */
export function idsDeSeleccion(body: Record<string, unknown>): { ids: string[] } | { error: string } {
  const raw = body.ids;
  if (!Array.isArray(raw) || raw.length === 0) return { error: SELECCION_MESSAGES.vacia };
  if (raw.length > SELECCION_MAX) return { error: SELECCION_MESSAGES.maximo };
  if (!raw.every((id) => typeof id === "string" && RECORD_ID_RE.test(id))) return { error: SELECCION_MESSAGES.inexistentes };
  return { ids: [...new Set(raw as string[])] };
}

/**
 * Relee de Airtable las horas pedidas (lotes de 100) y valida la selección: todas existen,
 * tienen proyecto, son de UN proyecto y Facturables (400). La usan el resumen, el Excel y el
 * cambio de Estado de facturación en lote (CC-F4-08).
 */
async function leerSeleccion(ids: readonly string[]): Promise<{ horas: (HoraP & { estadoFacturacion: string | null })[] } | { error: string }> {
  const client = getAirtableClient();
  const lotes = Array.from({ length: Math.ceil(ids.length / LOTE) }, (_, i) => ids.slice(i * LOTE, (i + 1) * LOTE));
  const fields = [...HORA_FIELDS, H.estadoFacturacion];
  const leidas = (await Promise.all(lotes.map((lote) => client.list(TABLES.horas.id, { fields, filterByFormula: or(...lote.map(recordIdIs)) })))).flat();
  // La fórmula filtra en Airtable; se vuelve a filtrar acá por el ID exacto.
  const pedidos = new Set(ids);
  const porId = new Map(leidas.filter((r) => pedidos.has(r.id)).map((r) => [r.id, r]));
  if (porId.size !== pedidos.size) return { error: SELECCION_MESSAGES.inexistentes };

  const horas = [...porId.values()].map((r) => ({
    id: r.id,
    fecha: typeof r.fields[H.fecha] === "string" ? (r.fields[H.fecha] as string) : null,
    colaborador: first(r.fields[H.colaborador]),
    proyecto: first(r.fields[H.proyecto]),
    tarea: text(r.fields[H.tarea]),
    desde: num(r.fields[H.horaDesde]),
    hasta: num(r.fields[H.horaHasta]),
    facturable: r.fields[H.facturable] === true,
    mesAFacturar: typeof r.fields[H.mesAFacturar] === "string" ? (r.fields[H.mesAFacturar] as string) : null,
    estadoFacturacion: typeof r.fields[H.estadoFacturacion] === "string" ? (r.fields[H.estadoFacturacion] as string) : null,
  }));
  if (horas.some((h) => !h.proyecto)) return { error: SELECCION_MESSAGES.sinProyecto };
  if (new Set(horas.map((h) => h.proyecto)).size > 1) return { error: SELECCION_MESSAGES.variosProyectos };
  if (horas.some((h) => !h.facturable)) return { error: SELECCION_MESSAGES.noFacturables };
  return { horas };
}

export async function cargarSeleccion(body: Record<string, unknown>): Promise<ServiceResult<SeleccionData>> {
  const v = idsDeSeleccion(body);
  if ("error" in v) return fail(400, v.error);
  const client = getAirtableClient();
  const leida = await leerSeleccion(v.ids);
  if ("error" in leida) return fail(400, leida.error);
  const horas: HoraP[] = leida.horas;

  const proyectoId = horas[0].proyecto!;
  const [proyecto, parametros, usuarios] = await Promise.all([
    client.get(TABLES.proyectos.id, proyectoId, { fields: PROYECTO_FIELDS }),
    client.list(TABLES.parametros.id, { fields: [PA.concepto, PA.valor] }),
    client.list(TABLES.usuarios.id, { fields: [TABLES.usuarios.fields.nombre] }),
  ]);
  if (!proyecto) return fail(400, SELECCION_MESSAGES.inexistentes);
  const alicuota = parseAlicuota(parametros.find((r) => text(r.fields[PA.concepto]) === PARAM_ALICUOTA)?.fields[PA.valor]);
  if (alicuota === null) return fail(409, PROFORMA_MESSAGES.alicuota);

  return {
    ok: true,
    data: calcularSeleccion({
      proyecto: {
        id: proyecto.id,
        codigo: text(proyecto.fields[P.codigo]) || "(sin código)",
        cliente: first(proyecto.fields[P.cliente]),
        valorHora: num(proyecto.fields[P.valorHora]),
        moneda: moneda(proyecto.fields[P.monedaValorHora]),
      },
      alicuota,
      horas,
      colaboradores: new Map(usuarios.map((r) => [r.id, text(r.fields[TABLES.usuarios.fields.nombre])])),
    }),
  };
}

/** La misma vista que la pantalla, como .xlsx. */
export function seleccionXlsx(d: SeleccionData): { bytes: Buffer; filename: string } {
  return { bytes: writeXlsx(vistaToSheet(vistaSeleccion(d), "Selección")), filename: nombreArchivoSeleccion(d) };
}

/**
 * Estado de facturación en lote (CC-F4-08). Body `{ ids, estado }`: las mismas validaciones que
 * la selección (≤ 500, existen, Facturables, un proyecto → 400) y un estado válido. Escribe SOLO
 * el Estado de facturación, en lotes de 10. Fail-closed: antes de cada lote se anota el valor
 * anterior de cada registro; si un lote falla se restauran todos los ya escritos (y el que falló)
 * → 503 «No se modificó nada»; si la restauración falla → 500 y se loguean solo los IDs.
 */
export async function marcarEstadoSeleccion(body: Record<string, unknown>): Promise<ServiceResult<{ actualizadas: number; estado: EstadoFacturacion }>> {
  const v = idsDeSeleccion(body);
  if ("error" in v) return fail(400, v.error);
  if (!isEstadoFacturacion(body.estado)) return fail(400, ESTADO_MESSAGES.invalido);
  const estado = body.estado;
  const leida = await leerSeleccion(v.ids);
  if ("error" in leida) return fail(400, leida.error);

  const updates = leida.horas.map((h) => ({ id: h.id, fields: { [H.estadoFacturacion]: estado }, previous: { [H.estadoFacturacion]: h.estadoFacturacion } }));
  if (updates.some((u) => invalidFieldIds(TABLES.horas.id, u.fields).length > 0 || invalidFieldIds(TABLES.horas.id, u.previous).length > 0)) {
    console.error("[horas] Payload inválido (bug del servidor)", { table: TABLES.horas.id });
    return { ok: false, status: 500, error: WRITE_MESSAGES.incompleto };
  }
  const tx = new Compensation();
  try {
    await tx.update(TABLES.horas.id, updates, (i) => injectFault(`estado:horas:${i}`));
  } catch {
    const ok = await rollbackAndLog(tx, "horas estado de facturación");
    return ok ? { ok: false, status: 503, error: WRITE_MESSAGES.revertido } : { ok: false, status: 500, error: WRITE_MESSAGES.incompleto };
  }
  return { ok: true, data: { actualizadas: updates.length, estado } };
}
