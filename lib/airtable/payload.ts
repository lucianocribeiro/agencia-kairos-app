import "server-only";

import { AirtableError } from "./errors";
import { COMPUTED_FIELDS, FIELD_TABLE, READ_ONLY_FIELDS, TABLE_IDS } from "./schema";

/**
 * Validaciones de IDs y payloads de escritura. Las usa el cliente antes de
 * cada request y los servicios para pre-validar escrituras de varios pasos
 * (cascadas) antes de escribir nada.
 */

const TABLE_ID_RE = /^tbl[A-Za-z0-9]{14}$/;
const FIELD_ID_RE = /^fld[A-Za-z0-9]{14}$/;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;

function invalid(message: string): AirtableError {
  return new AirtableError({ code: "invalid_input", message });
}

export function assertTableId(tableId: string): void {
  if (!TABLE_ID_RE.test(tableId)) {
    throw invalid(`Se esperaba un ID de tabla (tbl…), se recibió ${JSON.stringify(tableId)}`);
  }
}

/** Valida que sean IDs de campo y que pertenezcan a la tabla (si la tabla está en el schema). */
export function assertFieldIds(tableId: string, fieldIds: readonly string[]): void {
  for (const id of fieldIds) {
    if (!FIELD_ID_RE.test(id)) {
      throw invalid(`Se esperaba un ID de campo (fld…), se recibió ${JSON.stringify(id)}`);
    }
    if (TABLE_IDS.has(tableId) && FIELD_TABLE.get(id) !== tableId) {
      throw invalid(`El campo ${id} no pertenece a la tabla ${tableId}`);
    }
  }
}

/**
 * Guard de escritura: lanza si el payload tiene un campo calculado
 * (COMPUTED_FIELDS), un link inverso de solo lectura, o algo que no sea un ID
 * de campo de esa tabla.
 */
export function assertWritableFields(tableId: string, fields: Record<string, unknown>): void {
  const keys = Object.keys(fields);
  for (const key of keys) {
    if (COMPUTED_FIELDS.has(key)) {
      throw new AirtableError({
        code: "computed_field_write",
        message: `El campo ${key} es calculado y no se puede escribir`,
      });
    }
    if (READ_ONLY_FIELDS.has(key)) {
      throw new AirtableError({
        code: "read_only_field_write",
        message: `El campo ${key} es de solo lectura y no se puede escribir`,
      });
    }
  }
  assertFieldIds(tableId, keys);
}

export function assertRecordId(recordId: string): void {
  if (!RECORD_ID_RE.test(recordId)) {
    throw invalid(`ID de registro inválido: ${JSON.stringify(recordId)}`);
  }
}

export const isRecordId = (value: string): boolean => RECORD_ID_RE.test(value);
