/**
 * Horas: hora del día ↔ segundos y horas por registro. Client-safe (sin IDs).
 *
 * En Airtable, Hora desde / Hora hasta son duraciones en segundos desde las
 * 00:00. La app trabaja con precisión de minuto (múltiplos de 60).
 */

const TIME_RE = /^(\d{1,2}):(\d{2})$/;
export const MAX_TIME_SECONDS = 23 * 3600 + 59 * 60; // 23:59

/** "09:30" (o "9:30") → 34200. 00:00–23:59; cualquier otra cosa → null. */
export function parseTime(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const m = TIME_RE.exec(text.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 3600 + minutes * 60;
}

/** 34200 → "09:30". Se trunca al minuto. "" si no es una hora válida del día. */
export function formatTime(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 86_399) return "";
  const minutes = Math.floor(seconds / 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Horas de un registro = ROUND((hasta − desde) / 3600, 2), como la fórmula de
 * Airtable (fldTSWNksJnEbYTLW). ÚNICA función de horas: la usan las listas,
 * los totales y el dashboard.
 *
 * `Math.round(segundos / 36) / 100` es lo mismo que redondear (s / 3600) a 2
 * decimales, pero sin el error de punto flotante de multiplicar por 100.
 * Con segundos enteros los empates (…,5) se redondean hacia arriba, como ROUND.
 * Si falta alguna de las dos horas o el rango no es positivo → 0.
 *
 * Diferencia conocida: la fórmula de Airtable usa AND({desde}, {hasta}), así que
 * un registro que empieza a las 00:00 (desde = 0) queda en blanco allá; acá se
 * calcula igual (ver README, "Horas").
 */
export function recordHours(desde: number | null | undefined, hasta: number | null | undefined): number {
  if (typeof desde !== "number" || typeof hasta !== "number" || !Number.isFinite(desde) || !Number.isFinite(hasta)) return 0;
  const seconds = hasta - desde;
  if (seconds <= 0) return 0;
  return Math.round(seconds / 36) / 100;
}

/** Suma horas ya redondeadas sin acumular error de punto flotante (en centésimas). */
export function sumHours(values: Iterable<number>): number {
  let cents = 0;
  for (const v of values) cents += Math.round(v * 100);
  return cents / 100;
}

/** 1.5 → "1,50" (siempre 2 decimales, es-AR). */
export function formatHours(hours: number): string {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" }).format(hours);
}
