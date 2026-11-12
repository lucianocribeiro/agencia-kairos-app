"use client";

import type { FieldErrors } from "@/lib/abm/fields";

export interface ApiResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  error?: string;
  fieldErrors?: FieldErrors;
}

/** Llama a una API propia con JSON. Nunca lanza: los errores de red vuelven como status 0. */
export async function callApi(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: typeof data.error === "string" ? data.error : res.ok ? undefined : "Ocurrió un error. Probá de nuevo.",
      fieldErrors: (data.fieldErrors as FieldErrors | undefined) ?? undefined,
    };
  } catch {
    return { ok: false, status: 0, data: {}, error: "No pudimos conectarnos. Revisá tu conexión y probá de nuevo." };
  }
}
