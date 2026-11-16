import "server-only";

import { redirect } from "next/navigation";

import { isApiContext } from "./api-context";
import { CHANGE_PASSWORD_PATH, HOME_BY_ROLE, LOGIN_PATH, SESSION_EXPIRED_PATH } from "./constants";
import { getSessionState, type SessionUser } from "./session";

/**
 * Guards de autorización. Toda la autorización real pasa por acá; proxy.ts
 * solo filtra cookies faltantes o con firma inválida.
 *
 * - Páginas / Server Actions: redirigen (/login, /cambiar-password o el inicio del rol).
 * - Deny by default: un Cliente solo pasa requireCliente y requireSession (cambio de contraseña).
 * - Route Handlers envueltos en `apiRoute()`: lanzan AuthError → JSON 401/403.
 */

export const AUTH_MESSAGES = {
  noSession: "Tenés que iniciar sesión.",
  forbidden: "No tenés permiso para hacer esto.",
  mustChangePassword: "Tenés que cambiar la contraseña antes de seguir.",
} as const;

export class AuthError extends Error {
  readonly status: 401 | 403;
  /** La cookie existe pero es inválida: el handler la borra. */
  readonly clearCookie: boolean;

  constructor(status: 401 | 403, message: string, clearCookie = false) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.clearCookie = clearCookie;
  }
}

export interface GuardOptions {
  /** Solo /cambiar-password y su API: deja pasar a quien debe cambiar la contraseña. */
  allowPendingPasswordChange?: boolean;
}

/**
 * Cualquier rol con sesión válida (Admin, Empleado o Cliente). Solo para lo que es de
 * todos: /cambiar-password y su API. El resto usa requireUser / requireAdmin / requireCliente.
 */
export async function requireSession(options: GuardOptions = {}): Promise<SessionUser> {
  const api = isApiContext();
  const state = await getSessionState();

  if (state.status !== "valid") {
    const invalid = state.status === "invalid";
    if (api) throw new AuthError(401, AUTH_MESSAGES.noSession, invalid);
    // Una Server Component no puede borrar cookies: si es inválida, pasa por un Route Handler que la borra.
    redirect(invalid ? SESSION_EXPIRED_PATH : LOGIN_PATH);
  }

  const { user } = state;
  if (user.debeCambiarPassword && !options.allowPendingPasswordChange) {
    if (api) throw new AuthError(403, AUTH_MESSAGES.mustChangePassword);
    redirect(CHANGE_PASSWORD_PATH);
  }
  return user;
}

/** Rechaza (API 403) o manda a su inicio (páginas) a un rol que no corresponde. */
function denyRole(user: SessionUser): never {
  if (isApiContext()) throw new AuthError(403, AUTH_MESSAGES.forbidden);
  redirect(HOME_BY_ROLE[user.rol]);
}

/**
 * Admin o Empleado (páginas y APIs internas: Mis horas, app/api/me/**). Un Cliente nunca
 * pasa (deny by default): API → 403; página → su vista.
 */
export async function requireUser(options: GuardOptions = {}): Promise<SessionUser> {
  const user = await requireSession(options);
  if (user.rol !== "Admin" && user.rol !== "Empleado") denyRole(user);
  return user;
}

export async function requireAdmin(options: GuardOptions = {}): Promise<SessionUser> {
  const user = await requireSession(options);
  if (user.rol !== "Admin") denyRole(user);
  return user;
}

/** Solo Cliente (su vista y app/api/cliente/**). Admin → su inicio, Empleado → Mis horas; API → 403. */
export async function requireCliente(options: GuardOptions = {}): Promise<SessionUser> {
  const user = await requireSession(options);
  if (user.rol !== "Cliente") denyRole(user);
  return user;
}

/** Para /login y /: el usuario si la sesión es válida, si no null. No redirige. */
export async function getOptionalUser(): Promise<SessionUser | null> {
  const state = await getSessionState();
  return state.status === "valid" ? state.user : null;
}
