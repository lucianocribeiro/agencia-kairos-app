/**
 * Constantes de sesión. Sin `server-only` porque también las usa proxy.ts.
 * No contiene secretos.
 */
import type { Role } from "@/lib/roles";

export const SESSION_COOKIE = "kairos_session";
/** 12 h, sin renovación (no sliding). */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export const LOGIN_PATH = "/login";
export const CHANGE_PASSWORD_PATH = "/cambiar-password";
/** Limpia una cookie de sesión inválida y manda a /login (ver app/api/auth/expirada). */
export const SESSION_EXPIRED_PATH = "/api/auth/expirada";

export const HOME_BY_ROLE: Record<Role, string> = {
  Admin: "/dashboard",
  Empleado: "/mis-horas",
};

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}
