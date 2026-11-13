/**
 * Importes en pesos de Ventas y Compras, en centavos enteros. Client-safe.
 *
 * Redondeo: ROUND(x, 2) de Excel = mitad lejos del cero, sobre el valor con 15
 * dígitos significativos (como Excel). `toCents` toma `x.toPrecision(15)` y redondea
 * el texto decimal (sin multiplicar por 100 en punto flotante), así 1,005 → 1,01,
 * 2,675 → 2,68 y −1,005 → −1,01, igual que Excel (`Math.round(x * 100)` daría 1,00
 * y 2,67). Después se suma y resta en centavos enteros, sin error de punto flotante.
 */

/** ROUND(x, 2) de Excel, en centavos enteros (mitad lejos del cero). */
export function toCents(x: number): number {
  if (!Number.isFinite(x)) throw new RangeError("Importe no finito");
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const [mantissa, exp = "0"] = Math.abs(x).toPrecision(15).split("e");
  const [intPart, fracPart = ""] = mantissa.split(".");
  const digits = intPart + fracPart;
  // posición del punto decimal después de multiplicar por 100
  const point = intPart.length + Number(exp) + 2;
  if (point < 0) return 0; // < 0,001: redondea a 0
  const padded = digits.padEnd(point + 1, "0");
  const whole = point === 0 ? "0" : padded.slice(0, point);
  const next = Number(padded[point]);
  const cents = Number(BigInt(whole) + BigInt(next >= 5 ? 1 : 0));
  return cents === 0 ? 0 : sign * cents;
}

/** ROUND(x, 2) como número (p. ej. para comparar con Excel). */
export function round2(x: number): number {
  return toCents(x) / 100;
}

/** 123456 → 1234.56 */
export const centsToNumber = (cents: number): number => cents / 100;
