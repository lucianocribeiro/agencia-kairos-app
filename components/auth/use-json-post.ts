"use client";

import { useState } from "react";

export interface PostError {
  message: string;
  field?: string;
}

/** POST JSON a una API propia; si responde { redirectTo }, navega con recarga completa. */
export function useJsonPost(url: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PostError | null>(null);

  async function submit(body: unknown) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; field?: string; redirectTo?: string };
      if (res.ok && data.redirectTo) {
        window.location.assign(data.redirectTo);
        return; // queda en "pending" hasta que cambia la página
      }
      setError({ message: data.error ?? "Ocurrió un error. Probá de nuevo.", field: data.field });
    } catch {
      setError({ message: "No pudimos conectarnos. Revisá tu conexión y probá de nuevo." });
    }
    setPending(false);
  }

  return { submit, pending, error };
}
