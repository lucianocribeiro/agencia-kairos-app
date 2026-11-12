"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

export const LOGOUT_ERROR = "No pudimos cerrar la sesión. Probá de nuevo.";

/**
 * POST /api/auth/logout con JSON (la API exige JSON; ningún formulario HTML le postea).
 * Devuelve a dónde navegar si la respuesta fue 2xx, o null si hubo que mostrar error.
 * Separada del componente para poder testearla.
 */
export async function requestLogout(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { redirectTo?: unknown };
    return typeof data.redirectTo === "string" && data.redirectTo.startsWith("/") ? data.redirectTo : "/login";
  } catch {
    return null;
  }
}

/**
 * Cierra la sesión y navega a /login SOLO si el servidor respondió 2xx.
 * Si falla (red o no-2xx), se queda en la página, muestra el error y el botón
 * sigue disponible para reintentar.
 */
export function LogoutButton({
  className,
  label = "Cerrar sesión",
  compact = false,
  navigate = (url: string) => window.location.replace(url),
}: {
  className?: string;
  label?: string;
  compact?: boolean;
  /** Inyectable para tests. Por defecto, navegación completa con replace. */
  navigate?: (url: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function logout() {
    setPending(true);
    setError(false);
    const target = await requestLogout();
    if (target) {
      // Navegación completa: descarta el estado/caché del cliente de la sesión cerrada,
      // y replace saca la página logueada del historial.
      navigate(target);
      return;
    }
    setError(true);
    setPending(false);
  }

  return (
    <span className="relative inline-flex">
      <button type="button" onClick={logout} disabled={pending} aria-label={label} className={className}>
        <LogOut aria-hidden="true" className="size-4" />
        <span className={compact ? "hidden lg:inline" : undefined}>{label}</span>
      </button>
      {error && (
        <span
          role="alert"
          className="absolute top-full right-0 z-40 mt-1 w-64 rounded-md border border-danger/40 bg-card px-3 py-2 text-xs text-danger shadow-lg shadow-black/50"
        >
          {LOGOUT_ERROR}
        </span>
      )}
    </span>
  );
}
