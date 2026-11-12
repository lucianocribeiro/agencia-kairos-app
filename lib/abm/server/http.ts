import "server-only";

import { NextResponse } from "next/server";

import type { RawValues } from "@/lib/abm/fields";
import type { ServiceResult } from "@/lib/abm/types";

/** ServiceResult → Response JSON. Éxito: { ok: true, ...data }; error: { error, fieldErrors? }. */
export function toResponse<T extends object>(result: ServiceResult<T>, okStatus = 200): Response {
  if (result.ok) return NextResponse.json({ ok: true, ...result.data }, { status: okStatus });
  return NextResponse.json(
    { error: result.error, ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}) },
    { status: result.status },
  );
}

/** Claves de formulario válidas (las del spec son camelCase). Corta `__proto__`, IDs raros, etc. */
const KEY_RE = /^[a-z][A-Za-z0-9]{0,63}$/;
const FORBIDDEN_KEYS = new Set(["constructor", "prototype", "toString", "valueOf", "hasOwnProperty"]);

/**
 * Body JSON → valores de formulario (solo strings, booleans y arrays de
 * strings). Las claves que no tienen forma de clave del spec se descartan; los
 * servicios además ignoran toda clave que no esté en el spec.
 */
export function toRawValues(body: Record<string, unknown>): RawValues {
  const raw: RawValues = Object.create(null) as RawValues;
  for (const [key, value] of Object.entries(body)) {
    if (!KEY_RE.test(key) || FORBIDDEN_KEYS.has(key)) continue;
    if (typeof value === "string" || typeof value === "boolean") raw[key] = value;
    else if (Array.isArray(value)) raw[key] = value.filter((v): v is string => typeof v === "string");
    else if (typeof value === "number") raw[key] = String(value);
  }
  return raw;
}
