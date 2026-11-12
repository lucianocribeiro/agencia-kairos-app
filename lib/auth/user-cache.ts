import "server-only";

import type { AuthUser } from "./credentials";

/**
 * Caché por instancia (módulo) del usuario de la sesión. TTL 30 s, clave = ID
 * de usuario. Se invalida con las escrituras de ESTA instancia a ese usuario
 * (cambio de contraseña, último acceso; en adelante, toda escritura a Usuarios
 * tiene que llamar a `invalidateCachedUser`). Otras instancias ven el cambio
 * como máximo 30 s después.
 *
 * No es un caché entre requests de Next (`use cache`): vive en memoria del
 * proceso y no contiene el hash, solo su huella.
 */

export const USER_CACHE_TTL_MS = 30_000;

const cache = new Map<string, { user: AuthUser | null; expiresAt: number }>();

export async function getCachedUser(
  userId: string,
  load: (userId: string) => Promise<AuthUser | null>,
  now: number = Date.now(),
): Promise<AuthUser | null> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.user;
  const user = await load(userId);
  cache.set(userId, { user, expiresAt: now + USER_CACHE_TTL_MS });
  return user;
}

export function invalidateCachedUser(userId: string): void {
  cache.delete(userId);
}

/** Solo para tests. */
export function clearUserCache(): void {
  cache.clear();
}
