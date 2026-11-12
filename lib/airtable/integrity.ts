import "server-only";

import { getAirtableClient } from "./client";
import { and, field, formula, recordIdIs, type Formula } from "./formula";

/**
 * Chequeos de integridad compartidos por Usuarios y Maestros.
 * Siempre con IDs de campo y fórmulas escapadas. Además de la fórmula, se
 * vuelve a comparar en código (no depende solo de Airtable).
 */

export const REFERENCED_MESSAGE = "No se puede borrar: tiene registros asociados. Desactivalo o dejalo como está.";

/** Normalización para comparar unicidad: trim + minúsculas. */
export function normalizeForUnique(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Registros (distintos de `excludeId`) cuyo `fieldId` es igual a `value`
 * sin distinguir mayúsculas ni espacios alrededor. Fórmula:
 *   AND(LOWER(TRIM({fld} & "")) = "valor", RECORD_ID() != "recX")
 * (`& ""` convierte números a texto, así sirve también para campos numéricos).
 */
export async function findDuplicates(
  tableId: string,
  fieldId: string,
  value: unknown,
  options: { excludeId?: string } = {},
): Promise<{ id: string }[]> {
  const target = normalizeForUnique(value);
  if (!target) return [];
  let filter: Formula = formula`LOWER(TRIM(${field(fieldId)} & "")) = ${target}`;
  if (options.excludeId) filter = and(filter, formula`NOT(${recordIdIs(options.excludeId)})`);
  const records = await getAirtableClient().list(tableId, { fields: [fieldId], filterByFormula: filter });
  return records
    .filter((r) => r.id !== options.excludeId && normalizeForUnique(r.fields[fieldId]) === target)
    .map((r) => ({ id: r.id }));
}

export async function isUnique(
  tableId: string,
  fieldId: string,
  value: unknown,
  options: { excludeId?: string } = {},
): Promise<boolean> {
  return (await findDuplicates(tableId, fieldId, value, options)).length === 0;
}

/**
 * Links de `referenceFieldIds` (links inversos de schema.ts) que no están
 * vacíos en el registro. Si devuelve algo, el registro no se puede borrar.
 * Si el registro no existe, devuelve null.
 */
export async function findReferences(
  tableId: string,
  recordId: string,
  referenceFieldIds: readonly string[],
): Promise<{ fieldId: string; count: number }[] | null> {
  if (referenceFieldIds.length === 0) {
    throw new Error("findReferences necesita al menos un campo de referencia (ver REFERENCE_FIELDS)");
  }
  const record = await getAirtableClient().get(tableId, recordId, { fields: referenceFieldIds });
  if (!record) return null;
  return referenceFieldIds
    .map((fieldId) => {
      const value = record.fields[fieldId];
      return { fieldId, count: Array.isArray(value) ? value.length : value ? 1 : 0 };
    })
    .filter((r) => r.count > 0);
}
