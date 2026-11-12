import "server-only";

import type { Role } from "@/lib/roles";
import { RESTRICTED_FIELDS, SECRET_FIELDS } from "./schema";

/** ¿Puede este rol ver este campo? */
export function canReadField(fieldId: string, role: Role): boolean {
  if (SECRET_FIELDS.has(fieldId)) return false;
  if (role === "Empleado" && RESTRICTED_FIELDS.has(fieldId)) return false;
  return true;
}

/** Filtra una lista de campos a pedir según el rol. Usalo antes de armar `fields[]`. */
export function readableFields<T extends string>(fieldIds: readonly T[], role: Role): T[] {
  return fieldIds.filter((id) => canReadField(id, role));
}

/** Quita de un objeto `fields` todo lo que el rol no puede ver. */
export function redactFields<T extends Record<string, unknown>>(fields: T, role: Role): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(fields) as (keyof T & string)[]) {
    if (canReadField(key, role)) out[key] = fields[key];
  }
  return out;
}
