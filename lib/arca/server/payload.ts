import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { ArcaRow } from "@/lib/arca/adapter";
import type { Kind } from "@/lib/ventas-compras/columns";

/**
 * Payload firmado de la sincronización (CC-F5-03): la confirmación es sin estado, igual que
 * con el .xlsx. Las filas de ARCA viajan al navegador y vuelven firmadas con HMAC-SHA256;
 * el servidor verifica la firma (tiempo constante) y los claims, y recién ahí vuelve a
 * correr adaptador + parse + confirmImport.
 *
 * Clave: HMAC(SESSION_SECRET, "kairos-arca-sync-v1"). Nunca se firma con el secreto crudo.
 * Formato: base64url(JSON) + "." + base64url(firma).
 */

export const PAYLOAD_DOMAIN = "kairos-arca-sync-v1";
/** La vista previa vale 2 horas. */
export const PAYLOAD_TTL_MS = 2 * 60 * 60 * 1000;
/** Tope del payload serializado (el body de una función de Vercel no puede pasar 4,5 MB). */
export const MAX_PAYLOAD_CHARS = 3.5 * 1024 * 1024;

export const PAYLOAD_MESSAGES = {
  invalido: "La vista previa no es válida; sincronizá de nuevo.",
  vencido: "La vista previa venció; sincronizá de nuevo.",
  otraSincronizacion: "La vista previa no corresponde a esta sincronización; sincronizá de nuevo.",
  otroUsuario: "Esta vista previa es de otro usuario.",
  muyGrande: "La respuesta de ARCA es demasiado grande para revisarla de una vez. Elegí un período más corto.",
} as const;

export interface PayloadClaims {
  syncId: string;
  tabla: Kind;
  userId: string;
  /** ms desde epoch */
  issuedAt: number;
}

interface Body {
  v: 1;
  claims: PayloadClaims;
  rows: ArcaRow[];
}

const signingKey = (secret: string) => createHmac("sha256", secret).update(PAYLOAD_DOMAIN).digest();
const sign = (secret: string, data: string) => createHmac("sha256", signingKey(secret)).update(data).digest();

/** Firma filas + claims. null si el resultado pasa el tope (la vista previa lo rechaza). */
export function signPayload(secret: string, claims: PayloadClaims, rows: ArcaRow[]): string | null {
  const data = Buffer.from(JSON.stringify({ v: 1, claims, rows } satisfies Body)).toString("base64url");
  const token = `${data}.${sign(secret, data).toString("base64url")}`;
  return token.length > MAX_PAYLOAD_CHARS ? null : token;
}

export type VerifyResult =
  | { ok: true; claims: PayloadClaims; rows: ArcaRow[] }
  | { ok: false; status: 400 | 403; error: string };

const bad = (error: string, status: 400 | 403 = 400): VerifyResult => ({ ok: false, status, error });

/** Verifica firma y claims contra lo esperado (sync, tabla, usuario) y la vigencia. */
export function verifyPayload(secret: string, token: unknown, expected: { syncId: string; tabla: Kind; userId: string }, now: number = Date.now()): VerifyResult {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_PAYLOAD_CHARS) return bad(PAYLOAD_MESSAGES.invalido);
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return bad(PAYLOAD_MESSAGES.invalido);
  const data = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "base64url");
  const want = sign(secret, data);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return bad(PAYLOAD_MESSAGES.invalido);

  let body: Body;
  try {
    body = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as Body;
  } catch {
    return bad(PAYLOAD_MESSAGES.invalido);
  }
  const c = body?.claims;
  if (body?.v !== 1 || !c || typeof c.syncId !== "string" || typeof c.userId !== "string" || typeof c.issuedAt !== "number" || !Array.isArray(body.rows)) {
    return bad(PAYLOAD_MESSAGES.invalido);
  }
  if (c.userId !== expected.userId) return bad(PAYLOAD_MESSAGES.otroUsuario, 403);
  if (c.syncId !== expected.syncId || c.tabla !== expected.tabla) return bad(PAYLOAD_MESSAGES.otraSincronizacion);
  if (now - c.issuedAt > PAYLOAD_TTL_MS || c.issuedAt - now > 60_000) return bad(PAYLOAD_MESSAGES.vencido);
  return { ok: true, claims: c, rows: body.rows };
}
