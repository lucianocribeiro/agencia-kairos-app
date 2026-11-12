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

/** Caracteres de las contraseñas temporales: ASCII sin ambiguos (0/O, 1/l/I). Cada uno ocupa 1 byte. */
const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const TEMP_PASSWORD_LENGTH = 14;

/**
 * Contraseña temporal aleatoria de 14 caracteres que cumple la política
 * (usa crypto.getRandomValues; sirve en el navegador y en Node).
 * Rechazo por módulo para no sesgar la distribución.
 */
export function generateTemporaryPassword(length = TEMP_PASSWORD_LENGTH): string {
  const limit = 256 - (256 % TEMP_ALPHABET.length);
  let out = "";
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && out.length < length) out += TEMP_ALPHABET[b % TEMP_ALPHABET.length];
    }
  }
  return out;
}
