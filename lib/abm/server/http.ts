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

/** Body JSON → valores de formulario (solo strings, booleans y arrays de strings). */
export function toRawValues(body: Record<string, unknown>): RawValues {
  const raw: RawValues = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string" || typeof value === "boolean") raw[key] = value;
    else if (Array.isArray(value)) raw[key] = value.filter((v): v is string => typeof v === "string");
    else if (typeof value === "number") raw[key] = String(value);
  }
  return raw;
}
