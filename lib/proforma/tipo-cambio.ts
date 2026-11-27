/**
 * Tipo de cambio de la Proforma (CC-F5-21 · F5-06). Puro y client-safe: lo usan la pantalla de la
 * Proforma, su PDF y la Factura A (servidor), así la conversión sale siempre de la misma cuenta.
 *
 * Reglas:
 * - El TC lo escribe el Admin en la Proforma (pesos por dólar). No se guarda en Airtable desde la
 *   Proforma: viaja como parámetro (`?tc=` en la URL; `tipoCambio` en el body de emitir).
 * - Válido: texto es-AR validado como texto (`parseTipoCambio`), > 0, ≤ 1.000.000 y con hasta 4 decimales.
 * - Subtotales por moneda en centavos enteros, como siempre (`totalesPorMoneda`).
 *   netoArsDesdeUsd = toCents(subtotalUsd / 100 × TC); neto = subtotalArs + netoArsDesdeUsd;
 *   IVA = toCents(neto / 100 × alícuota) (`ivaDe`); total = neto + IVA.
 * - Nunca se suman USD y ARS sin convertir.
 */
import { formatNumber } from "@/lib/format";
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

/** Largo máximo del texto del TC (antes de normalizar). */
export const TC_MAX_LARGO = 20;

/**
 * Texto es-AR → TC válido, o null (CC-F5-22 · F5-09-01: se valida el TEXTO, nunca con tolerancia
 * de punto flotante). Pasos:
 * 1. ≤ 20 caracteres; se ignoran solo los espacios de los bordes (adentro, ninguno).
 * 2. Normalización es-AR (las formas de `parseNumberInput`): miles con punto y coma decimal
 *    («1.050,25»), coma decimal («1050,25», «,5») o un único punto decimal con 4+ enteros («1050.25»).
 * 3. El texto normalizado tiene que ser `dígitos[.dígitos]` con dígitos ASCII: sin signo, sin
 *    exponente, sin espacios, sin dígitos Unicode.
 * 4. Se sacan los ceros finales de los decimales y quedan como máximo 4 («1,23450» = 1,2345).
 * 5. Recién ahí se convierte: el número es exactamente el decimal escrito; > 0 y ≤ 1.000.000.
 */
export function parseTipoCambio(text: unknown): number | null {
  if (typeof text !== "string" || text.length > TC_MAX_LARGO) return null;
  const s = text.trim();
  let normalizado: string;
  if (/^[0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?$/.test(s)) normalizado = s.replaceAll(".", "").replace(",", ".");
  else if (/^[0-9]*(,[0-9]+)?$/.test(s)) normalizado = s.replace(",", ".");
  else if (/^[0-9]{4,}\.[0-9]+$/.test(s)) normalizado = s;
  else return null;
  const m = /^([0-9]*)(?:\.([0-9]+))?$/.exec(normalizado);
  if (!m || (m[1] === "" && m[2] === undefined)) return null;
  const decimales = (m[2] ?? "").replace(/0+$/, "");
  if (decimales.length > TC_MAX_DECIMALES) return null;
  const n = Number(`${m[1] || "0"}${decimales ? `.${decimales}` : ""}`);
  return Number.isFinite(n) && n > 0 && n <= TC_MAX ? n : null;
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

/** Fila de «Totales por moneda» (centavos). */
export interface FilaTotal {
  label: string;
  subtotal: number;
  iva: number;
  total: number;
}

/**
 * Filas de «Totales por moneda» (CC-F5-23 · F5-07; pantalla y PDF salen de acá). Una fila por moneda
 * nativa, como siempre. Con TC válido (`d.conversion`) se agrega una fila en pesos con los valores de
 * `convertirAPesos` (ningún cálculo nuevo): solo USD → «ARS (TC <tc>)»; mixta → «Total en pesos (TC <tc>)».
 */
export function filasTotales(d: Pick<ProformaData, "totales" | "conversion">): FilaTotal[] {
  const filas: FilaTotal[] = d.totales.map((t) => ({ label: t.moneda, subtotal: t.subtotal, iva: t.iva, total: t.total }));
  const cv = d.conversion;
  if (cv) {
    const tc = formatTipoCambio(cv.tipoCambio);
    filas.push({ label: cv.mixta ? `Total en pesos (TC ${tc})` : `ARS (TC ${tc})`, subtotal: cv.neto, iva: cv.iva, total: cv.total });
  }
  return filas;
}
