import "server-only";

import { setPassword, verifyPasswordById } from "./credentials";
import { byteLength, PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from "./password";

export const PASSWORD_MESSAGES = {
  incompleto: "Completá los tres campos.",
  corta: `La contraseña nueva tiene que tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  larga: `La contraseña nueva puede tener hasta ${PASSWORD_MAX_BYTES} caracteres.`,
  noCoinciden: "Las contraseñas nuevas no coinciden.",
  igual: "La contraseña nueva tiene que ser distinta de la actual.",
  actualIncorrecta: "La contraseña actual no es correcta.",
} as const;

export type PasswordField = "actual" | "nueva" | "repetir";

export type PasswordChangeResult =
  | { ok: true; pf: string }
  | { ok: false; status: 400; error: string; field?: PasswordField };

/** Reglas sin tocar Airtable. Exportada para tests y para reusar en el form. */
export function validateNewPassword(input: {
  actual: unknown;
  nueva: unknown;
  repetir: unknown;
}): { error: string; field?: PasswordField } | null {
  const { actual, nueva, repetir } = input;
  if (typeof actual !== "string" || typeof nueva !== "string" || typeof repetir !== "string" || !actual || !nueva || !repetir) {
    return { error: PASSWORD_MESSAGES.incompleto };
  }
  if (nueva.length < PASSWORD_MIN_LENGTH) return { error: PASSWORD_MESSAGES.corta, field: "nueva" };
  if (byteLength(nueva) > PASSWORD_MAX_BYTES) return { error: PASSWORD_MESSAGES.larga, field: "nueva" };
  if (nueva !== repetir) return { error: PASSWORD_MESSAGES.noCoinciden, field: "repetir" };
  if (nueva === actual) return { error: PASSWORD_MESSAGES.igual, field: "nueva" };
  return null;
}

export async function changePassword(
  userId: string,
  input: { actual: unknown; nueva: unknown; repetir: unknown },
): Promise<PasswordChangeResult> {
  const invalid = validateNewPassword(input);
  if (invalid) return { ok: false, status: 400, ...invalid };

  const actual = input.actual as string;
  if (!(await verifyPasswordById(userId, actual))) {
    return { ok: false, status: 400, error: PASSWORD_MESSAGES.actualIncorrecta, field: "actual" };
  }
  const pf = await setPassword(userId, input.nueva as string);
  return { ok: true, pf };
}
