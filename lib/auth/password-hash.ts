/**
 * Hashing y comparación de contraseñas (bcrypt). Solo servidor y el script de bootstrap.
 *
 * Sin `server-only` y sin alias `@/` porque lo importa scripts/bootstrap-admin.mjs
 * con `node --experimental-strip-types` (por eso el import con extensión .ts).
 * No contiene secretos: DUMMY_HASH es el hash de un valor aleatorio descartado.
 * Que nunca llegue al cliente lo verifica test/client-boundary.test.ts.
 */
import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";

import { byteLength, checkNewPassword, PASSWORD_MAX_BYTES } from "./password-policy.ts";

export const BCRYPT_COST = 12;

/** Hash fijo (costo 12) para comparar cuando no hay usuario o la contraseña es inválida (mismo tiempo). */
export const DUMMY_HASH = "$2b$12$b5L5oVTthrYRXcDpLfrFk.BFM6G8QO.GMs6P/9wXIftfEf2hbDAra";

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
