import "server-only";

import { cookies } from "next/headers";
import { connection, type NextResponse } from "next/server";
import { cache } from "react";

import { getEnv } from "@/lib/env";
import type { Role } from "@/lib/roles";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, sessionCookieOptions } from "./constants";
import { loadAuthUser } from "./credentials";
import { signSessionToken, verifySessionToken } from "./token";
import { getCachedUser } from "./user-cache";

/** Lo que el resto de la app sabe del usuario logueado. */
export interface SessionUser {
  id: string;
  nombre: string;
  email: string;
  rol: Role;
  debeCambiarPassword: boolean;
}

export type SessionState =
  | { status: "none" }
  /** Había cookie pero no sirve: hay que borrarla. */
  | { status: "invalid" }
  | { status: "valid"; user: SessionUser };

/**
 * Valida un token: firma + 12 h, y después el usuario (caché 30 s):
 * inválida si no existe, si Estado ≠ Activo o si `pf` no coincide.
 */
export async function resolveSession(token: string | undefined, now: Date): Promise<SessionState> {
  if (!token) return { status: "none" };
  const payload = await verifySessionToken(token, getEnv().SESSION_SECRET, now);
  if (!payload) return { status: "invalid" };

  const user = await getCachedUser(payload.sub, loadAuthUser, now.getTime());
  if (!user || !user.activo || !user.pf || user.pf !== payload.pf) return { status: "invalid" };

  return {
    status: "valid",
    user: {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
      debeCambiarPassword: user.debeCambiarPassword,
    },
  };
}

/** Sesión del request actual (deduplicada por request con React cache). Siempre dinámica. */
export const getSessionState = cache(async (): Promise<SessionState> => {
  // Request time explícito: la validación usa la hora actual (vencimiento, caché de 30 s).
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(token, new Date());
});

export async function setSessionCookie(res: NextResponse, data: { userId: string; pf: string }): Promise<void> {
  const token = await signSessionToken(data, getEnv().SESSION_SECRET);
  res.cookies.set(SESSION_COOKIE, token, { ...sessionCookieOptions(), maxAge: SESSION_MAX_AGE_SECONDS });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
}
