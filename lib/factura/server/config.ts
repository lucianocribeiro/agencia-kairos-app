import "server-only";

import { getArcaConfig } from "@/lib/arca/server/config";
import { DEV_CUIT_EMISOR, FACTURA_MESSAGES, type Ambiente } from "../factura";

/**
 * Configuración de la factura electrónica (CC-F5-10). Todas las variables son opcionales y se
 * leen en cada llamada (perezoso), como AFIP_SDK_TOKEN; nunca están en REQUIRED_ENV_VARS.
 *
 * - AFIP_WSFE_ENV: "prod" = Producción; cualquier otra cosa (o vacía) = "dev" (Homologación).
 * - AFIP_CERT_B64 / AFIP_KEY_B64: certificado y clave privada PEM, cada uno en base64 en una
 *   línea. Solo en "prod". Si falta o es inválido → no configurada (503); NUNCA se cae a dev.
 * - El token de Afip SDK es el mismo de la sincronización (AFIP_SDK_TOKEN).
 *
 * Ningún valor se loguea ni se devuelve: al navegador solo llega el ambiente y si está configurada.
 */

export type WsfeEnvironment = "dev" | "prod";

export interface FacturaConfig {
  token: string;
  baseUrl: string;
  environment: WsfeEnvironment;
  ambiente: Ambiente;
  /** Solo "prod": PEM ya decodificados y validados. */
  cert: string | null;
  key: string | null;
  /** "dev": la CUIT de prueba de Afip SDK; "prod": null (la CUIT sale de Parámetros). */
  cuitFija: string | null;
}

export function wsfeEnvironment(): WsfeEnvironment {
  return process.env.AFIP_WSFE_ENV?.trim() === "prod" ? "prod" : "dev";
}

export const ambienteDe = (env: WsfeEnvironment): Ambiente => (env === "prod" ? "Producción" : "Homologación");

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** base64 de una línea → PEM del tipo pedido, o null. Nunca lanza ni loguea. */
export function decodePem(value: string | undefined, kind: "certificate" | "key"): string | null {
  const b64 = (value ?? "").trim();
  if (!b64 || b64.length > 64 * 1024 || !BASE64_RE.test(b64)) return null;
  let pem: string;
  try {
    pem = Buffer.from(b64, "base64").toString("utf8").replace(/\r\n/g, "\n").trim();
  } catch {
    return null;
  }
  // CC-F5-11: certificado = CERTIFICATE; clave = PRIVATE KEY, RSA PRIVATE KEY o EC PRIVATE KEY con el MISMO rótulo en BEGIN y END.
  const label = kind === "certificate" ? /^-----BEGIN CERTIFICATE-----\n[\s\S]+\n-----END CERTIFICATE-----$/ : /^-----BEGIN ((?:RSA |EC )?PRIVATE KEY)-----\n[\s\S]+\n-----END \1-----$/;
  return label.test(pem) ? pem : null;
}

export type FacturaConfigResult = { ok: true; config: FacturaConfig } | { ok: false; ambiente: Ambiente; error: string };

export function getFacturaConfig(): FacturaConfigResult {
  const environment = wsfeEnvironment();
  const ambiente = ambienteDe(environment);
  const arca = getArcaConfig();
  if (!arca) return { ok: false, ambiente, error: FACTURA_MESSAGES.noConfigurada };
  if (environment === "prod") {
    const cert = decodePem(process.env.AFIP_CERT_B64, "certificate");
    const key = decodePem(process.env.AFIP_KEY_B64, "key");
    if (!cert || !key) return { ok: false, ambiente, error: FACTURA_MESSAGES.prodSinCertificado };
    return { ok: true, config: { token: arca.token, baseUrl: arca.baseUrl, environment, ambiente, cert, key, cuitFija: null } };
  }
  return { ok: true, config: { token: arca.token, baseUrl: arca.baseUrl, environment, ambiente, cert: null, key: null, cuitFija: DEV_CUIT_EMISOR } };
}
