/**
 * Fechas de Horas, siempre como "YYYY-MM-DD" (sin hora ni zona). Client-safe.
 * "Hoy" es la fecha actual en America/Argentina/Buenos_Aires.
 */

export const HORAS_TIME_ZONE = "America/Argentina/Buenos_Aires";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es una fecha real con formato "YYYY-MM-DD"? */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");
const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fromUtc = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Fecha de hoy en Buenos Aires ("YYYY-MM-DD"). Se calcula en el servidor para las reglas. */
export function todayInBuenosAires(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: HORAS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(iso: string, days: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Días entre dos fechas (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export interface DateRange {
  desde: string;
  hasta: string;
}

function monthRange(year: number, month: number): DateRange {
  // month: 1–12 (se normaliza si se pasa de rango)
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { desde: fromUtc(first), hasta: fromUtc(last) };
}

const ym = (iso: string) => [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))] as const;

export const PERIOD_SHORTCUTS = {
  mesActual: "Mes actual",
  mesAnterior: "Mes anterior",
  trimestreActual: "Trimestre actual",
  anioActual: "Año actual",
} as const;
export type PeriodShortcut = keyof typeof PERIOD_SHORTCUTS;

/** Rango de un atajo de período, relativo a `today` ("YYYY-MM-DD"). El trimestre es calendario. */
export function shortcutRange(shortcut: PeriodShortcut, today: string): DateRange {
  const [y, m] = ym(today);
  switch (shortcut) {
    case "mesActual":
      return monthRange(y, m);
    case "mesAnterior":
      return monthRange(y, m - 1);
    case "trimestreActual": {
      const q = Math.floor((m - 1) / 3) * 3 + 1;
      return { desde: monthRange(y, q).desde, hasta: monthRange(y, q + 2).hasta };
    }
    case "anioActual":
      return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
  }
}

/** Lunes de la semana ISO de una fecha. */
export function isoWeekMonday(iso: string): string {
  const day = toUtc(iso).getUTCDay(); // 0 = domingo
  return addDays(iso, day === 0 ? -6 : 1 - day);
}

/** "2026-11-12" → "12/11/2026". */
export function displayDate(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "2026-11-01" → "11/2026" (Mes a facturar). */
export function displayMonth(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}/.test(iso)) return "";
  return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Mes a facturar: "2026-11" o "2026-11-01" → "2026-11-01" (se guarda así). null si no es válido. */
export function mesAFacturarToStorage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-01`;
  return isIsoDate(iso) ? iso : null;
}

// ── Agrupación del dashboard ─────────────────────────────────────────────────

export const GROUPINGS = { diaria: "Diaria", semanal: "Semanal", mensual: "Mensual" } as const;
export type Grouping = keyof typeof GROUPINGS;

export interface Bucket {
  /** día "YYYY-MM-DD", lunes de la semana ISO, o "YYYY-MM". */
  key: string;
  label: string;
  /** Parte del período que cubre (los bordes pueden ser parciales). */
  desde: string;
  hasta: string;
}

/** Clave del bucket al que pertenece una fecha. */
export function bucketKey(iso: string, grouping: Grouping): string {
  if (grouping === "diaria") return iso;
  if (grouping === "semanal") return isoWeekMonday(iso);
  return iso.slice(0, 7);
}

/**
 * Buckets que cubren todo [desde, hasta]. Semanas ISO (lunes), etiqueta
 * "Sem DD/MM" con el lunes; meses "MM/AAAA"; días "DD/MM". Las semanas y
 * meses de los bordes se incluyen aunque queden parciales.
 */
export function buildBuckets(range: DateRange, grouping: Grouping): Bucket[] {
  const out: Bucket[] = [];
  let cursor = range.desde;
  while (cursor <= range.hasta) {
    const key = bucketKey(cursor, grouping);
    let end: string;
    let label: string;
    if (grouping === "diaria") {
      end = cursor;
      label = `${cursor.slice(8, 10)}/${cursor.slice(5, 7)}`;
    } else if (grouping === "semanal") {
      end = addDays(key, 6);
      label = `Sem ${key.slice(8, 10)}/${key.slice(5, 7)}`;
    } else {
      end = monthRange(...ym(cursor)).hasta;
      label = `${key.slice(5, 7)}/${key.slice(0, 4)}`;
    }
    out.push({ key, label, desde: cursor, hasta: end < range.hasta ? end : range.hasta });
    cursor = addDays(end, 1);
  }
  return out;
}
