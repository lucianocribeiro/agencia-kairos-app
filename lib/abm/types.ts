/** Tipos que viajan del servidor al cliente en los ABM. Client-safe. */
import type { FieldErrors, Values } from "./fields";

export interface LinkOption {
  id: string;
  label: string;
}

export interface RecordDTO {
  id: string;
  /** Valores por clave del spec (no por ID de campo). */
  values: Values;
  /** Cantidad de registros que lo referencian (links inversos). 0 = se puede borrar. */
  referenceCount?: number;
}

export interface AbmData {
  records: RecordDTO[];
  /** Por clave de link: id → etiqueta (todas, para mostrar). */
  labels: Record<string, Record<string, string>>;
  /** Por clave de link: opciones que se pueden elegir. */
  options: Record<string, LinkOption[]>;
}

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 403 | 404 | 405 | 409 | 500 | 503; error: string; fieldErrors?: FieldErrors };
