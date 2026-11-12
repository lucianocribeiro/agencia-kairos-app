import "server-only";

import { getAirtableClient, type AirtableRecord, type Fields } from "@/lib/airtable/client";
import { and, field, formula, type Formula } from "@/lib/airtable/formula";
import { TABLES } from "@/lib/airtable/schema";
import { WrittenRecordMissingError } from "@/lib/airtable/integrity";
import type { CheckConflict, PostWriteCheck } from "@/lib/abm/server/compensation";
import { addDays, isIsoDate, type DateRange } from "../dates";
import { overlapMessage, overlapping } from "../rules";
import { recordHours } from "../time";

/**
 * Acceso a la tabla Horas. Nunca pide valor hora, moneda, importe ni la
 * lookup de cliente (RESTRICTED_FIELDS): lo que no se lee no se puede filtrar.
 */

export const H = TABLES.horas.fields;
export const HORAS_TABLE = TABLES.horas.id;

/** Campos que se leen de Horas (para Admin y Empleado). */
export const HORAS_READ_FIELDS = [
  H.fecha,
  H.colaborador,
  H.proyecto,
  H.tarea,
  H.horaDesde,
  H.horaHasta,
  H.facturable,
  H.mesAFacturar,
  H.cargadoPor,
] as const;

export interface Hora {
  id: string;
  createdTime: string;
  fecha: string | null;
  colaborador: string | null;
  proyecto: string | null;
  tarea: string;
  desde: number | null;
  hasta: number | null;
  facturable: boolean;
  mesAFacturar: string | null;
  cargadoPor: string | null;
  /** recordHours(desde, hasta): la única cuenta de horas. */
  horas: number;
}

const firstId = (v: unknown) => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);

export function toHora(record: AirtableRecord): Hora {
  const f = record.fields;
  const desde = num(f[H.horaDesde]);
  const hasta = num(f[H.horaHasta]);
  return {
    id: record.id,
    createdTime: record.createdTime,
    fecha: str(f[H.fecha]),
    colaborador: firstId(f[H.colaborador]),
    proyecto: firstId(f[H.proyecto]),
    tarea: str(f[H.tarea]) ?? "",
    desde,
    hasta,
    facturable: f[H.facturable] === true,
    mesAFacturar: str(f[H.mesAFacturar]),
    cargadoPor: firstId(f[H.cargadoPor]),
    horas: recordHours(desde, hasta),
  };
}

/**
 * Filtro por rango de Fecha (campo date). Bordes exclusivos sobre el día
 * anterior y el posterior, así un valor de solo fecha (medianoche) del primer
 * y del último día entra siempre:
 *   AND({fecha}, IS_AFTER({fecha}, "desde − 1 día"), IS_BEFORE({fecha}, "hasta + 1 día"))
 * Después se vuelve a filtrar en código por el string "YYYY-MM-DD".
 */
export function fechaRangeFormula(range: DateRange): Formula {
  const f = field(H.fecha);
  return and(f, formula`IS_AFTER(${f}, ${addDays(range.desde, -1)})`, formula`IS_BEFORE(${f}, ${addDays(range.hasta, 1)})`);
}

/** Registros con Fecha dentro de [desde, hasta] (incluidos). */
export async function listHorasInRange(range: DateRange): Promise<Hora[]> {
  const records = await getAirtableClient().list(HORAS_TABLE, { fields: HORAS_READ_FIELDS, filterByFormula: fechaRangeFormula(range) });
  return records
    .map(toHora)
    .filter((h) => h.fecha !== null && isIsoDate(h.fecha) && h.fecha >= range.desde && h.fecha <= range.hasta);
}

export async function getHora(id: string): Promise<Hora | null> {
  const record = await getAirtableClient().get(HORAS_TABLE, id, { fields: HORAS_READ_FIELDS });
  return record ? toHora(record) : null;
}

/** Orden de las listas: Fecha desc, después Desde asc. */
export function sortHoras<T extends { fecha: string | null; desde: number | null }>(list: T[]): T[] {
  return list.sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || (a.desde ?? 0) - (b.desde ?? 0));
}

// ── Superposición ────────────────────────────────────────────────────────────

export interface Slot {
  colaborador: string;
  fecha: string;
  desde: number;
  hasta: number;
}

/** Registros del mismo Colaborador y la misma Fecha que se pisan con `slot` (sin `excludeId`). */
export async function findOverlaps(slot: Slot, excludeId?: string): Promise<Hora[]> {
  const day = await listHorasInRange({ desde: slot.fecha, hasta: slot.fecha });
  const others = day.filter(
    (h) => h.id !== excludeId && h.colaborador === slot.colaborador && h.desde !== null && h.hasta !== null,
  ) as (Hora & { desde: number; hasta: number })[];
  return overlapping(slot, others);
}

export function overlapConflict(found: readonly { desde: number | null; hasta: number | null }[]): CheckConflict {
  const msg = overlapMessage(found.map((h) => ({ desde: h.desde ?? 0, hasta: h.hasta ?? 0 })));
  return { error: msg, fieldErrors: { desde: msg } };
}

/**
 * Verificación posterior de superposición (carreras), para runPostWriteChecks:
 * - edit: si se pisa con otro, quien edita vuelve a su valor anterior;
 * - create: pierde el más nuevo (createdTime más reciente; empate: ID más alto).
 *   Si este registro es más viejo que todos con los que choca, se queda (los
 *   otros requests ven lo mismo y se deshacen).
 * Si la relectura no trae el registro escrito → WrittenRecordMissingError (fail-closed).
 */
export function overlapPostCheck(id: string, slot: Slot, mode: "create" | "edit"): PostWriteCheck {
  return {
    name: "overlap",
    run: async () => {
      const day = await listHorasInRange({ desde: slot.fecha, hasta: slot.fecha });
      const me = day.find((h) => h.id === id);
      // Sin el registro escrito no se puede verificar nada: lectura fallida (deshacer → 503).
      if (!me) throw new WrittenRecordMissingError(id);
      const others = overlapping(
        slot,
        day.filter((h) => h.id !== id && h.colaborador === slot.colaborador && h.desde !== null && h.hasta !== null) as (Hora & {
          desde: number;
          hasta: number;
        })[],
      );
      if (others.length === 0) return null;
      if (mode === "edit") return overlapConflict(others);
      const t = (h: Hora) => Date.parse(h.createdTime);
      const olderExists = others.some((o) => t(o) < t(me) || (t(o) === t(me) && o.id < me.id));
      return olderExists ? overlapConflict(others) : null;
    },
  };
}

/** Valores del registro → campos de Airtable (por ID). Solo lo que vino. */
export function horaFields(v: {
  fecha?: string;
  proyecto?: string;
  tarea?: string;
  desde?: number;
  hasta?: number;
  colaborador?: string;
  cargadoPor?: string;
  facturable?: boolean;
  mesAFacturar?: string | null;
}): Fields {
  const out: Fields = {};
  if (v.fecha !== undefined) out[H.fecha] = v.fecha;
  if (v.proyecto !== undefined) out[H.proyecto] = [v.proyecto];
  if (v.tarea !== undefined) out[H.tarea] = v.tarea;
  if (v.desde !== undefined) out[H.horaDesde] = v.desde;
  if (v.hasta !== undefined) out[H.horaHasta] = v.hasta;
  if (v.colaborador !== undefined) out[H.colaborador] = [v.colaborador];
  if (v.cargadoPor !== undefined) out[H.cargadoPor] = [v.cargadoPor];
  if (v.facturable !== undefined) out[H.facturable] = v.facturable;
  if (v.mesAFacturar !== undefined) out[H.mesAFacturar] = v.mesAFacturar;
  return out;
}

/** Registro actual → mismos campos (para el rollback de una edición). */
export function horaFieldsOf(h: Hora, keys: readonly string[]): Fields {
  const all: Fields = {
    [H.fecha]: h.fecha,
    [H.proyecto]: h.proyecto ? [h.proyecto] : [],
    [H.tarea]: h.tarea || null,
    [H.horaDesde]: h.desde,
    [H.horaHasta]: h.hasta,
    [H.colaborador]: h.colaborador ? [h.colaborador] : [],
    [H.cargadoPor]: h.cargadoPor ? [h.cargadoPor] : [],
    [H.facturable]: h.facturable,
    [H.mesAFacturar]: h.mesAFacturar,
  };
  return Object.fromEntries(keys.map((k) => [k, all[k] ?? null]));
}
