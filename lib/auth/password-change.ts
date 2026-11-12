import "server-only";

import { setPassword, verifyPasswordById } from "./credentials";
import { isLockedOut, LockoutUnavailableError, recordAttempt } from "./lockout";
import { LOGIN_MESSAGES } from "./login";
import { checkNewPassword } from "./password-policy";

export const PASSWORD_MESSAGES = {
  incompleto: "Completá los tres campos.",
  noCoinciden: "Las contraseñas nuevas no coinciden.",
  igual: "La contraseña nueva tiene que ser distinta de la actual.",
  actualIncorrecta: "La contraseña actual no es correcta.",
  bloqueado: LOGIN_MESSAGES.bloqueado,
  noDisponible: LOGIN_MESSAGES.noDisponible,
} as const;

export type PasswordField = "actual" | "nueva" | "repetir";

export type PasswordChangeResult =
  | { ok: true; pf: string }
  | { ok: false; status: 400 | 429 | 503; error: string; field?: PasswordField };

/** Reglas sin tocar Airtable (la política es la de lib/auth/password-policy.ts). */
export function validateNewPassword(input: {
  actual: unknown;
  nueva: unknown;
  repetir: unknown;
}): { error: string; field?: PasswordField } | null {
  const { actual, nueva, repetir } = input;
  if (typeof actual !== "string" || typeof nueva !== "string" || typeof repetir !== "string" || !actual || !nueva || !repetir) {
    return { error: PASSWORD_MESSAGES.incompleto };
  }
  const policy = checkNewPassword(nueva);
  if (policy) return { error: policy, field: "nueva" };
  if (nueva !== repetir) return { error: PASSWORD_MESSAGES.noCoinciden, field: "repetir" };
  if (nueva === actual) return { error: PASSWORD_MESSAGES.igual, field: "nueva" };
  return null;
}

/**
 * Cambio de contraseña con el mismo bloqueo que el login (mismo contador en
 * "Intentos de login", por email e IP): bloqueado → Bloqueado + 429; contraseña
 * actual incorrecta → Fallido + 400; éxito → Exitoso (reinicia el contador).
 * Si no se puede leer el bloqueo → 503.
 */
export async function changePassword(
  user: { id: string; email: string },
  input: { actual: unknown; nueva: unknown; repetir: unknown },
  ip: string,
  now: Date = new Date(),
): Promise<PasswordChangeResult> {
  const invalid = validateNewPassword(input);
  if (invalid) return { ok: false, status: 400, ...invalid };

  try {
    if (await isLockedOut(user.email, ip, now)) {
      await recordAttempt(user.email, ip, "Bloqueado", now);
      return { ok: false, status: 429, error: PASSWORD_MESSAGES.bloqueado };
    }
  } catch (err) {
    if (err instanceof LockoutUnavailableError) return { ok: false, status: 503, error: PASSWORD_MESSAGES.noDisponible };
    throw err;
  }

  let ok: boolean;
  try {
    ok = await verifyPasswordById(user.id, input.actual as string);
  } catch {
    return { ok: false, status: 503, error: PASSWORD_MESSAGES.noDisponible };
  }
  if (!ok) {
    await recordAttempt(user.email, ip, "Fallido", now);
    return { ok: false, status: 400, error: PASSWORD_MESSAGES.actualIncorrecta, field: "actual" };
  }

  const pf = await setPassword(user.id, input.nueva as string);
  // Igual que un login exitoso: reinicia el contador de Fallido del email.
  // recordAttempt loguea y no lanza si la escritura falla.
  await recordAttempt(user.email, ip, "Exitoso", now);
  return { ok: true, pf };
}
