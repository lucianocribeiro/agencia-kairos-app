/**
 * Firma y verificación del token de sesión (JWT HS256 con jose).
 *
 * Sin `server-only` porque lo usa también proxy.ts; recibe el secreto por
 * parámetro y no lee el entorno. Payload: `sub` (ID del registro de usuario),
 * `iat` y `pf` (huella del hash de la contraseña). Nada más.
 * El vencimiento se controla con `maxTokenAge` sobre `iat` (12 h, sin sliding).
 */
import { jwtVerify, SignJWT } from "jose";

import { SESSION_MAX_AGE_SECONDS } from "./constants";

export interface SessionPayload {
  /** ID del registro en Usuarios */
  sub: string;
  /** issued-at, en segundos */
  iat: number;
  /** primeros 16 hex de SHA-256(passwordHash) */
  pf: string;
}

const ALG = "HS256";
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const PF_RE = /^[a-f0-9]{16}$/;

function key(secret: string): Uint8Array {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET inválido");
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(
  data: { userId: string; pf: string },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({ pf: data.pf })
    .setProtectedHeader({ alg: ALG, typ: "JWT" })
    .setSubject(data.userId)
    .setIssuedAt(nowSeconds)
    .sign(key(secret));
}

/** Devuelve el payload si la firma es válida y no venció; si no, null. Nunca lanza. */
export async function verifySessionToken(
  token: string | undefined,
  secret: string | undefined,
  now: Date = new Date(),
): Promise<SessionPayload | null> {
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: [ALG],
      maxTokenAge: SESSION_MAX_AGE_SECONDS,
      currentDate: now,
    });
    const { sub, iat, pf } = payload;
    if (typeof sub !== "string" || !RECORD_ID_RE.test(sub)) return null;
    if (typeof iat !== "number") return null;
    if (typeof pf !== "string" || !PF_RE.test(pf)) return null;
    // iat en el futuro (más de 1 min de tolerancia): inválido
    if (iat > now.getTime() / 1000 + 60) return null;
    return { sub, iat, pf };
  } catch {
    return null;
  }
}
