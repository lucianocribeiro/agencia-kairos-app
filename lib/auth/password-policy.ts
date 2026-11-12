/**
 * Política de contraseñas nuevas: reglas puras, sin dependencias.
 * Es el ÚNICO módulo de lib/auth/** que puede importar código cliente
 * (lo verifica test/client-boundary.test.ts). También lo usa el bootstrap.
 * Solo sintaxis TypeScript "borrable" (el bootstrap lo corre con --experimental-strip-types).
 */

export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt solo usa los primeros 72 bytes: más que eso se rechaza (nunca se trunca). */
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_POLICY_MESSAGES = {
  corta: `La contraseña tiene que tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  larga: "La contraseña no puede superar los 72 bytes (los caracteres con tilde o emojis ocupan más de uno).",
} as const;

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Largo en caracteres (code points: un emoji cuenta como 1). */
export function charLength(text: string): number {
  return [...text].length;
}

/** Valida una contraseña nueva. Devuelve el mensaje de error o null si es válida. */
export function checkNewPassword(password: string): string | null {
  if (charLength(password) < PASSWORD_MIN_LENGTH) return PASSWORD_POLICY_MESSAGES.corta;
  if (byteLength(password) > PASSWORD_MAX_BYTES) return PASSWORD_POLICY_MESSAGES.larga;
  return null;
}
