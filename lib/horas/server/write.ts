import "server-only";

import type { Fields } from "@/lib/airtable/client";
import { invalidFieldIds } from "@/lib/airtable/payload";
import { Compensation, runPostWriteChecks } from "@/lib/abm/server/compensation";
import type { ServiceResult } from "@/lib/abm/types";
import { isIsoDate, shortcutRange, type DateRange } from "../dates";
import { HORAS_TABLE, horaFieldsOf, overlapPostCheck, type Hora, type Slot } from "./repo";

export const GENERIC_ERROR = "Ocurrió un error. Probá de nuevo.";
export const RANGE_MESSAGES = {
  fecha: "Elegí fechas válidas para el período.",
  orden: "La fecha desde tiene que ser anterior o igual a la fecha hasta.",
  largo: "El período no puede superar los 10 años.",
} as const;
const MAX_RANGE_YEARS = 10;

/** La misma fecha `years` años calendario después; un 29/02 cae en 28/02 si el año destino no es bisiesto. */
export function addCalendarYears(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) + years;
  const md = iso.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return md === "02-29" && !leap ? `${y}-02-28` : `${y}-${md}`;
}

export const fail = (status: 400 | 403 | 404 | 409 | 500, error: string, fieldErrors?: Record<string, string>): ServiceResult<never> => ({
  ok: false,
  status,
  error,
  ...(fieldErrors ? { fieldErrors } : {}),
});

/** Período de un query (desde/hasta "YYYY-MM-DD"). Sin ninguno → mes actual. */
export function resolveRange(desde: string | null, hasta: string | null, today: string): { range: DateRange } | { error: string } {
  if (!desde && !hasta) return { range: shortcutRange("mesActual", today) };
  if (!isIsoDate(desde) || !isIsoDate(hasta)) return { error: RANGE_MESSAGES.fecha };
  if (desde > hasta) return { error: RANGE_MESSAGES.orden };
  // Hasta 10 años calendario exactos: hasta ≤ desde + 10 años (mismo día y mes).
  if (hasta > addCalendarYears(desde, MAX_RANGE_YEARS)) return { error: RANGE_MESSAGES.largo };
  return { range: { desde, hasta } };
}

/**
 * Escribe un registro de Horas (Empleado y Admin) con la verificación
 * posterior de superposición (fail-closed, deshace su propia escritura).
 * Un payload inválido es un bug del servidor → 500 sin escribir nada.
 */
export async function writeHora(
  target: { mode: "create" } | { mode: "edit"; existing: Hora },
  fields: Fields,
  slot: Slot,
): Promise<ServiceResult<{ id: string }>> {
  const bad = invalidFieldIds(HORAS_TABLE, fields);
  if (bad.length > 0) {
    console.error("[horas] Payload inválido (bug del servidor)", { table: HORAS_TABLE, fields: bad });
    return fail(500, GENERIC_ERROR);
  }
  const tx = new Compensation();
  let id: string;
  if (target.mode === "create") id = await tx.create(HORAS_TABLE, fields);
  else {
    id = target.existing.id;
    await tx.update(HORAS_TABLE, [{ id, fields, previous: horaFieldsOf(target.existing, Object.keys(fields)) }]);
  }
  const failed = await runPostWriteChecks(tx, id, [overlapPostCheck(id, slot, target.mode)]);
  return failed ?? { ok: true, data: { id } };
}
