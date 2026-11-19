import "server-only";

/**
 * Configuración de la sincronización con ARCA (CC-F5-03). Separada de lib/env.ts a propósito:
 * AFIP_SDK_TOKEN NO está en REQUIRED_ENV_VARS. Si falta, el resto de la app funciona igual y
 * solo la sincronización responde 503 «no está configurada» (y la página muestra el botón
 * deshabilitado: el servidor pasa un booleano, nunca el token).
 */

export const DEFAULT_AFIP_SDK_URL = "https://app.afipsdk.com/api/v1";

export const ARCA_CONFIG_MESSAGES = {
  noConfigurada: "La sincronización con ARCA no está configurada.",
} as const;

export interface ArcaConfig {
  token: string;
  baseUrl: string;
}

/**
 * Base URL alternativa SOLO para el smoke test con `next dev` (un stub local). Misma doble
 * compuerta que lib/abm/server/fault-injection.ts: `NODE_ENV === "development"` (Next la
 * reemplaza por "production" al compilar `next build`, así que el resto queda como código
 * muerto; check:bundle verifica que el nombre de la variable no quede en .next/server) y
 * además solo se acepta http://localhost o http://127.0.0.1.
 */
function devBaseUrlOverride(): string | null {
  if (process.env.NODE_ENV !== "development") return null;
  const value = process.env.AFIP_SDK_BASE_URL?.trim();
  if (!value) return null;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/[\w./-]*)?$/.test(value) ? value.replace(/\/+$/, "") : null;
}

/** Token y base URL, o null si la integración no está configurada. Se lee en cada llamada (perezoso). */
export function getArcaConfig(): ArcaConfig | null {
  const token = process.env.AFIP_SDK_TOKEN?.trim();
  if (!token) return null;
  return { token, baseUrl: devBaseUrlOverride() ?? DEFAULT_AFIP_SDK_URL };
}

/** Lo único que llega al navegador: si se puede sincronizar o no. */
export function isArcaConfigured(): boolean {
  return getArcaConfig() !== null;
}
