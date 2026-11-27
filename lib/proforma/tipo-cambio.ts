/**
 * Tipo de cambio de la Proforma (CC-F5-21 · F5-06). Puro y client-safe: lo usan la pantalla de la
 * Proforma, su PDF y la Factura A (servidor), así la conversión sale siempre de la misma cuenta.
 *
 * Reglas:
 * - El TC lo escribe el Admin en la Proforma (pesos por dólar). No se guarda en Airtable desde la
 *   Proforma: viaja como parámetro (`?tc=` en la URL; `tipoCambio` en el body de emitir).
 * - Válido: número es-AR (`parseNumberInput`), > 0, ≤ 1.000.000 y con hasta 4 decimales.
 * - Subtotales por moneda en centavos enteros, como siempre (`totalesPorMoneda`).
 *   netoArsDesdeUsd = toCents(subtotalUsd / 100 × TC); neto = subtotalArs + netoArsDesdeUsd;
 *   IVA = toCents(neto / 100 × alícuota) (`ivaDe`); total = neto + IVA.
 * - Nunca se suman USD y ARS sin convertir.
 */
import { formatNumber, parseNumberInput } from "@/lib/format";
import { toCents } from "@/lib/ventas-compras/money";
import { ivaDe, type ProformaData, type TotalMoneda } from "./proforma";

export const TC_MAX = 1_000_000;
export const TC_MAX_DECIMALES = 4;

export const TC_MESSAGES = {
  invalido: "Ingresá un tipo de cambio válido: mayor a 0, hasta 1.000.000 y con hasta 4 decimales (ej.: 1.050,25).",
  label: "Tipo de cambio (pesos por USD)",
} as const;

/** TC con hasta 4 decimales, en es-AR («1.050,2575»). Vuelve a leerse igual con `parseTipoCambio`. */
export const formatTipoCambio = (tc: number): string => formatNumber(tc, { maxDecimals: TC_MAX_DECIMALES });

/**
 * Texto es-AR → TC válido, o null. Acepta lo mismo que `parseNumberInput` («1050,5», «1.050,5»,
 * «1050.5» con 4+ enteros). Rechaza ≤ 0, > 1.000.000 y más de 4 decimales significativos
 * («1,23450» vale: es 1,2345).
 */
export function parseTipoCambio(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const n = parseNumberInput(text);
  if (n === null || !(n > 0) || n > TC_MAX) return null;
  const escalado = n * 10 ** TC_MAX_DECIMALES;
  const entero = Math.round(escalado);
  // Hasta 4 decimales: el valor × 10⁴ es (casi) entero. El margen cubre el error de punto flotante
  // (1234,5678 × 10⁴ = 12345678,000000002) y no deja pasar un quinto decimal (≥ 0,1 de diferencia).
  if (Math.abs(escalado - entero) > 1e-6 * Math.max(1, Math.abs(escalado))) return null;
  return entero / 10 ** TC_MAX_DECIMALES;
}

/**
 * Parámetro opcional (query o body): ausente o vacío → `{ tc: null }`; texto válido → `{ tc }`;
 * cualquier otra cosa → `{ error }` (el mensaje es-AR).
 */
export function leerTipoCambio(raw: unknown): { tc: number | null } | { error: string } {
  if (raw === undefined || raw === null) return { tc: null };
  if (typeof raw !== "string") return { error: TC_MESSAGES.invalido };
  if (raw.trim() === "") return { tc: null };
  const tc = parseTipoCambio(raw);
  return tc === null ? { error: TC_MESSAGES.invalido } : { tc };
}

export interface ConversionTC {
  tipoCambio: number;
  /** Centavos. 0 si no hay parte en esa moneda. */
  subtotalArs: number;
  subtotalUsd: number;
  /** toCents(subtotalUsd / 100 × TC). */
  netoArsDesdeUsd: number;
  /** Pesos: neto = subtotalArs + netoArsDesdeUsd; IVA sobre el neto total; total = neto + IVA. */
  neto: number;
  iva: number;
  total: number;
  /** Hay parte en ARS y en USD. */
  mixta: boolean;
}

/** Pesos de un subtotal en USD (centavos) a un TC. */
export const netoArsDesdeUsd = (subtotalUsd: number, tc: number): number => (subtotalUsd === 0 ? 0 : toCents((subtotalUsd / 100) * tc) || 0);

/** Subtotales por moneda (centavos) de los totales de la proforma. */
export function subtotales(totales: readonly Pick<TotalMoneda, "moneda" | "subtotal">[]): { ars: number; usd: number; hayArs: boolean; hayUsd: boolean } {
  const ars = totales.find((t) => t.moneda === "ARS");
  const usd = totales.find((t) => t.moneda === "USD");
  return { ars: ars?.subtotal ?? 0, usd: usd?.subtotal ?? 0, hayArs: ars !== undefined, hayUsd: usd !== undefined };
}

/** La única cuenta de la conversión (pantalla, PDF y factura). */
export function convertirAPesos(totales: readonly Pick<TotalMoneda, "moneda" | "subtotal">[], tc: number, alicuota: number): ConversionTC {
  const s = subtotales(totales);
  const desdeUsd = netoArsDesdeUsd(s.usd, tc);
  const neto = s.ars + desdeUsd;
  const iva = ivaDe(neto, alicuota);
  return { tipoCambio: tc, subtotalArs: s.ars, subtotalUsd: s.usd, netoArsDesdeUsd: desdeUsd, neto, iva, total: neto + iva, mixta: s.hayArs && s.hayUsd };
}

/** ¿Hay totales en USD? (solo entonces se pide el TC). */
export const tieneUsd = (totales: readonly Pick<TotalMoneda, "moneda">[]): boolean => totales.some((t) => t.moneda === "USD");

/** Detalle sugerido de la factura con parte en USD: «Equivalente a USD 1.234,56 a TC 1.050,25». */
export const detalleEquivalente = (subtotalUsd: number, tc: number): string => `Equivalente a USD ${formatNumber(subtotalUsd / 100, { decimals: 2 })} a TC ${formatTipoCambio(tc)}`;

/** La proforma con su equivalente en pesos (solo con USD y TC); si no, la misma, sin cambios. */
export function aplicarTipoCambio(d: ProformaData, tc: number | null): ProformaData {
  if (tc === null || !tieneUsd(d.totales)) return d;
  return { ...d, conversion: convertirAPesos(d.totales, tc, d.alicuota) };
}

/**
 * Filas del bloque «Equivalente en pesos» (pantalla y PDF salen de acá): con proforma mixta, primero
 * la parte en ARS y la de USD convertida; siempre Neto, IVA y Total.
 */
export function equivalenteFilas(cv: ConversionTC, alicuotaLabel: string): { label: string; cents: number; destacado: boolean }[] {
  const filas: { label: string; cents: number; destacado: boolean }[] = [];
  if (cv.mixta) {
    filas.push({ label: "Parte en ARS (neto)", cents: cv.subtotalArs, destacado: false });
    filas.push({ label: `USD ${formatNumber(cv.subtotalUsd / 100, { decimals: 2 })} a TC ${formatTipoCambio(cv.tipoCambio)} (neto)`, cents: cv.netoArsDesdeUsd, destacado: false });
  }
  filas.push({ label: "Neto", cents: cv.neto, destacado: true });
  filas.push({ label: alicuotaLabel, cents: cv.iva, destacado: true });
  filas.push({ label: "Total", cents: cv.total, destacado: true });
  return filas;
}
