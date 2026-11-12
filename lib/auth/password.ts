import "server-only";

import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";

export const BCRYPT_COST = 12;

/** bcrypt solo usa los primeros 72 bytes: más que eso no se acepta para contraseñas nuevas. */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_LENGTH = 10;

/**
 * Hash fijo (costo 12) de un valor aleatorio descartado. Se compara contra él
 * cuando el email no existe, para que el tiempo de respuesta sea el mismo.
 */
export const DUMMY_HASH = "$2b$12$b5L5oVTthrYRXcDpLfrFk.BFM6G8QO.GMs6P/9wXIftfEf2hbDAra";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/** Compara siempre (aunque el hash falte, contra DUMMY_HASH) y nunca lanza. */
export async function comparePassword(password: string, hash: string | null | undefined): Promise<boolean> {
  const target = typeof hash === "string" && hash.startsWith("$2") ? hash : DUMMY_HASH;
  try {
    const ok = await bcrypt.compare(password, target);
    return ok && target !== DUMMY_HASH;
  } catch {
    return false;
  }
}

/** `pf` de la sesión: primeros 16 hex de SHA-256(hash). Cambia cuando cambia la contraseña. */
export function passwordFingerprint(hash: string): string {
  return createHash("sha256").update(hash).digest("hex").slice(0, 16);
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
