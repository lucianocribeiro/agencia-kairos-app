"use client";

import type { ApiResult } from "@/components/abm/api";

/** GET a una API propia. Nunca lanza: los errores de red vuelven como status 0. */
export async function getApi(url: string): Promise<ApiResult> {
  try {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: typeof data.error === "string" ? data.error : res.ok ? undefined : "Ocurrió un error. Probá de nuevo.",
    };
  } catch {
    return { ok: false, status: 0, data: {}, error: "No pudimos conectarnos. Revisá tu conexión y probá de nuevo." };
  }
}

/** Query string sin valores vacíos. */
export function query(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
