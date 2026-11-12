import "server-only";

import { CHANGE_PASSWORD_PATH, HOME_BY_ROLE } from "./constants";
import { normalizeEmail, verifyPasswordByEmail, type AuthUser } from "./credentials";
import { isLockedOut, LockoutUnavailableError, recordAttempt } from "./lockout";
import { touchUltimoAcceso } from "./users";

export const LOGIN_MESSAGES = {
  robot: "Marcá la casilla «No soy un robot».",
  incompleto: "Completá el email y la contraseña.",
  bloqueado: "Demasiados intentos. Probá de nuevo en 15 minutos.",
  incorrecto: "Email o contraseña incorrectos.",
  noDisponible: "No pudimos validar el acceso. Probá de nuevo.",
} as const;

const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 1024;

export interface LoginInput {
  email: unknown;
  password: unknown;
  robot: unknown;
  ip: string;
}

export type LoginResult =
  | { ok: true; user: AuthUser; redirectTo: string }
  | { ok: false; status: 400 | 401 | 429 | 503; error: string };

/** IP del cliente: x-real-ip, si no el primer valor de x-forwarded-for, si no "desconocida". */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "desconocida";
}

export function homeFor(user: Pick<AuthUser, "rol" | "debeCambiarPassword">): string {
  return user.debeCambiarPassword ? CHANGE_PASSWORD_PATH : HOME_BY_ROLE[user.rol];
}

/**
 * Flujo de login (sin cookies: la cookie la pone el Route Handler).
 * El orden de los pasos está fijado por CC-F1-02.
 */
export async function attemptLogin(input: LoginInput, now: Date = new Date()): Promise<LoginResult> {
  // 1. Casilla "No soy un robot". No se registra nada.
  if (input.robot !== true) return { ok: false, status: 400, error: LOGIN_MESSAGES.robot };

  if (
    typeof input.email !== "string" ||
    typeof input.password !== "string" ||
    !input.email.trim() ||
    !input.password ||
    input.email.length > MAX_EMAIL_LENGTH ||
    input.password.length > MAX_PASSWORD_LENGTH
  ) {
    return { ok: false, status: 400, error: LOGIN_MESSAGES.incompleto };
  }

  // 2. Normalizar.
  const email = normalizeEmail(input.email);
  const ip = input.ip;

  // 3. Bloqueo (falla cerrado). Misma respuesta exista o no el email.
  try {
    if (await isLockedOut(email, ip, now)) {
      await recordAttempt(email, ip, "Bloqueado", now);
      return { ok: false, status: 429, error: LOGIN_MESSAGES.bloqueado };
    }
  } catch (err) {
    if (err instanceof LockoutUnavailableError) {
      return { ok: false, status: 503, error: LOGIN_MESSAGES.noDisponible };
    }
    throw err;
  }

  // 4–5. Buscar y comparar (con hash fijo si no existe). Mismo mensaje en los tres casos.
  let user: AuthUser | null;
  try {
    user = await verifyPasswordByEmail(email, input.password);
  } catch {
    return { ok: false, status: 503, error: LOGIN_MESSAGES.noDisponible };
  }
  if (!user || !user.activo) {
    await recordAttempt(email, ip, "Fallido", now);
    return { ok: false, status: 401, error: LOGIN_MESSAGES.incorrecto };
  }

  // 6. Éxito.
  await recordAttempt(email, ip, "Exitoso", now);
  await touchUltimoAcceso(user.id, now);
  return { ok: true, user, redirectTo: homeFor(user) };
}
