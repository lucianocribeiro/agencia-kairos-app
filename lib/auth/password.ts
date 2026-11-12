/**
 * Política y hashing de contraseñas. ÚNICO lugar donde se crea un hash.
 *
 * Sin `server-only` y sin alias `@/`: este archivo lo importa también
 * scripts/bootstrap-admin.mjs (con `node --experimental-strip-types`). No
 * contiene secretos; DUMMY_HASH es el hash de un valor aleatorio descartado.
 * Solo usar sintaxis TypeScript "borrable" (sin enums ni namespaces).
 *
 * bcrypt solo mira los primeros 72 bytes: más que eso se rechaza (nunca se trunca).
 */
import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";

export const BCRYPT_COST = 12;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_POLICY_MESSAGES = {
  corta: `La contraseña tiene que tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  larga: "La contraseña no puede superar los 72 bytes (los caracteres con tilde o emojis ocupan más de uno).",
} as const;

/** Hash fijo (costo 12) para comparar cuando no hay usuario o la contraseña es inválida (mismo tiempo). */
export const DUMMY_HASH = "$2b$12$b5L5oVTthrYRXcDpLfrFk.BFM6G8QO.GMs6P/9wXIftfEf2hbDAra";

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Valida una contraseña nueva. Devuelve el mensaje de error o null si es válida. */
export function checkNewPassword(password: string): string | null {
  if ([...password].length < PASSWORD_MIN_LENGTH) return PASSWORD_POLICY_MESSAGES.corta;
  if (byteLength(password) > PASSWORD_MAX_BYTES) return PASSWORD_POLICY_MESSAGES.larga;
  return null;
}

export class InvalidPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPasswordError";
  }
}

/**
 * La única función que crea hashes: valida la política y después hashea.
 * La usan el cambio de contraseña, el bootstrap y (CC-F1-03) el alta/reset de usuarios.
 */
export async function hashNewPassword(password: string): Promise<string> {
  const problem = checkNewPassword(password);
  if (problem) throw new InvalidPasswordError(problem);
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Compara siempre (sin hash o con contraseña de más de 72 bytes, contra
 * DUMMY_HASH para igualar el tiempo) y nunca lanza. Nunca trunca.
 */
export async function comparePassword(password: string, hash: string | null | undefined): Promise<boolean> {
  const tooLong = byteLength(password) > PASSWORD_MAX_BYTES;
  const validHash = typeof hash === "string" && hash.startsWith("$2");
  try {
    if (tooLong || !validHash) {
      await bcrypt.compare("comparación-de-tiempo", DUMMY_HASH);
      return false;
    }
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/** `pf` de la sesión: primeros 16 hex de SHA-256(hash). Cambia cuando cambia la contraseña. */
export function passwordFingerprint(hash: string): string {
  return createHash("sha256").update(hash).digest("hex").slice(0, 16);
}
