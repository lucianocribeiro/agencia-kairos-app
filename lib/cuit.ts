/**
 * CUIT / CUIL: se guarda solo con dígitos (11) y se muestra como XX-XXXXXXXX-X.
 * Dígito verificador: módulo 11 con pesos 5,4,3,2,7,6,5,4,3,2.
 * Funciones puras: se usan en el servidor (fuente de verdad) y en el formulario.
 */

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export const CUIT_MESSAGES = {
  formato: "El CUIT tiene que tener 11 dígitos.",
  verificador: "El CUIT no es válido (dígito verificador incorrecto).",
} as const;

/** Saca todo lo que no sea dígito. */
export function normalizeCuit(text: string): string {
  return text.replace(/\D/g, "");
}

/** Dígito verificador esperado para los primeros 10 dígitos, o null si no existe (resultado 10). */
export function cuitCheckDigit(first10: string): number | null {
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(first10[i]), 0);
  const check = 11 - (sum % 11);
  if (check === 11) return 0;
  if (check === 10) return null;
  return check;
}

/** Valida un CUIT (con o sin guiones). Devuelve los 11 dígitos, o un mensaje de error. */
export function parseCuit(text: string): { digits: string } | { error: string } {
  const digits = normalizeCuit(text);
  if (digits.length !== 11) return { error: CUIT_MESSAGES.formato };
  const expected = cuitCheckDigit(digits.slice(0, 10));
  if (expected === null || expected !== Number(digits[10])) return { error: CUIT_MESSAGES.verificador };
  return { digits };
}

export function isValidCuit(text: string): boolean {
  return "digits" in parseCuit(text);
}

/** "20123456786" → "20-12345678-6". Si no son 11 dígitos, devuelve el texto tal cual. */
export function formatCuit(text: string | null | undefined): string {
  if (!text) return "";
  const d = normalizeCuit(text);
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : text;
}
