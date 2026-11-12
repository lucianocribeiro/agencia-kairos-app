/**
 * Formatos es-AR. Funciones puras: se pueden usar en servidor y en cliente.
 *
 * - Fechas: DD/MM/AAAA (Airtable guarda AAAA-MM-DD).
 * - Números: separador de miles "." y decimal ",".
 * - Duraciones: segundos enteros ↔ "HH:mm".
 * - Porcentajes: la API de Airtable usa decimales (0.5 = 50 %).
 */

export const LOCALE = "es-AR";
export const TIME_ZONE = "America/Argentina/Buenos_Aires";

// ── Fechas ──────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DISPLAY_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * "2026-11-12" → "12/11/2026".
 * Acepta también un dateTime ISO completo y lo muestra en hora de Buenos Aires.
 * Devuelve "" si el valor está vacío o es inválido.
 */
export function isoToDisplayDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = ISO_DATE_RE.exec(iso);
  if (m) {
    const [, y, mo, d] = m;
    return isValidDate(+y, +mo, +d) ? `${d}/${mo}/${y}` : "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** "12/11/2026" (o "1/2/2026") → "2026-11-12". Devuelve null si no es una fecha válida. */
export function displayDateToIso(display: string | null | undefined): string | null {
  if (!display) return null;
  const m = DISPLAY_DATE_RE.exec(display.trim());
  if (!m) return null;
  const day = +m[1];
  const month = +m[2];
  const year = +m[3];
  if (!isValidDate(year, month, day)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** dateTime ISO → "12/11/2026 14:30" en hora de Buenos Aires. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

// ── Números ─────────────────────────────────────────────────────────────────

/** 1234.5 → "1.234,5". Con `decimals` fija la cantidad de decimales. */
export function formatNumber(
  value: number | null | undefined,
  options: { decimals?: number; minDecimals?: number; maxDecimals?: number } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const min = options.decimals ?? options.minDecimals ?? 0;
  const max = options.decimals ?? options.maxDecimals ?? Math.max(2, min);
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: "always",
  }).format(value);
}

/** 1234.5, "ARS" → "$ 1.234,50"; "USD" → "US$ 1.234,50". */
export function formatCurrency(value: number | null | undefined, currency: "ARS" | "USD"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: "always",
  }).format(value);
}

/** "1.234,56" → 1234.56. Devuelve null si no es un número válido. */
export function parseNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/\s/g, "");
  if (!/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// ── Duraciones ──────────────────────────────────────────────────────────────

/**
 * 34200 → "09:30". Se trunca al minuto. Admite más de 24 h (p. ej. totales: "27:15").
 */
export function secondsToHHmm(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  const sign = seconds < 0 ? "-" : "";
  const totalMinutes = Math.floor(Math.abs(seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${sign}${pad2(hours)}:${pad2(minutes)}`;
}

/** "09:30" (o "9:30") → 34200. Devuelve null si el formato es inválido. */
export function hhmmToSeconds(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^(\d{1,3}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const hours = +m[1];
  const minutes = +m[2];
  if (minutes > 59) return null;
  return hours * 3600 + minutes * 60;
}

/** 5400 → 1.5. Horas decimales redondeadas a 2 decimales. */
export function secondsToDecimalHours(seconds: number | null | undefined): number {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 0;
  // seconds / 3600 * 100 === seconds / 36
  return Math.round(seconds / 36) / 100;
}

// ── Porcentajes ─────────────────────────────────────────────────────────────

/** 0.5 → "50%"; 0.125 → "12,5%" (formato CLDR es-AR). */
export function percentToDisplay(decimal: number | null | undefined, maxDecimals = 2): string {
  if (decimal === null || decimal === undefined || !Number.isFinite(decimal)) return "";
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    maximumFractionDigits: maxDecimals,
  }).format(decimal);
}

/** "50", "50%", "12,5 %" → 0.5 / 0.125. Devuelve null si no es válido. */
export function displayToPercent(text: string | null | undefined): number | null {
  if (!text) return null;
  const n = parseNumber(text.replace(/%/g, ""));
  if (n === null) return null;
  return Math.round(n * 1e6) / 1e8;
}
