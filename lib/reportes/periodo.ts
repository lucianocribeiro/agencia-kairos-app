/**
 * Período de los reportes: 12 meses desde un mes inicial ("AAAA-MM"), ambos extremos
 * incluidos. Client-safe y puro.
 */

/** Parámetro (Concepto) con el mes inicial por defecto de los reportes. */
export const PARAM_PRIMER_MES = "Primer mes de los reportes";

export const PERIODO_MESSAGES = {
  parametro: "Revisá el parámetro Primer mes de los reportes en Maestros.",
  mes: "Elegí un mes válido (AAAA-MM).",
} as const;

const MES_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Años soportados: 2000–2099. El mes inicial va de 2000-01 a 2099-01, así los 12 meses terminan a más tardar en 2099-12. */
export const MES_INICIAL_MIN = "2000-01";
export const MES_INICIAL_MAX = "2099-01";

/** ¿Es un mes inicial válido? "AAAA-MM" entre 2000-01 y 2099-01 (comparación de texto: mismo formato). */
export const isMes = (v: unknown): v is string => typeof v === "string" && MES_RE.test(v) && v >= MES_INICIAL_MIN && v <= MES_INICIAL_MAX;

/** Valor del parámetro: "AAAA-MM-DD" o "AAAA-MM" → "AAAA-MM", dentro del rango de isMes. Otro valor → null. */
export function parsePrimerMes(valor: unknown): string | null {
  const s = typeof valor === "string" ? valor.trim() : "";
  const m = /^(\d{4}-(?:0[1-9]|1[0-2]))(?:-(\d{2}))?$/.exec(s);
  if (!m) return null;
  if (m[2] !== undefined) {
    const [y, mo] = m[1].split("-").map(Number);
    const day = Number(m[2]);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (day < 1 || day > last) return null;
  }
  return isMes(m[1]) ? m[1] : null;
}

/** "2026-11" + n meses → "AAAA-MM". */
export function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** "2026-01" → "01/2026". */
export const mesLabel = (mes: string): string => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;

/** "2026-01" → "202601" (nombres de archivo). */
export const mesCompacto = (mes: string): string => mes.replace("-", "");

export interface Periodo {
  /** Mes inicial y final ("AAAA-MM"), incluidos. */
  desde: string;
  hasta: string;
  /** Los 12 meses, en orden. */
  meses: string[];
  /** «Período: mm/aaaa a mm/aaaa». */
  label: string;
}

export function periodoDesde(desde: string): Periodo {
  const meses = Array.from({ length: 12 }, (_, i) => sumarMeses(desde, i));
  return { desde, hasta: meses[11], meses, label: `Período: ${mesLabel(desde)} a ${mesLabel(meses[11])}` };
}

/**
 * Mes inicial: el de la URL si viene (tiene que ser AAAA-MM válido); si no, el del
 * parámetro; si falta o no es válido, enero del año de `hoy` con un aviso.
 */
export function resolverPeriodo(
  query: string | null | undefined,
  parametro: unknown,
  hoy: string,
): { periodo: Periodo; aviso: string | null } | { error: string } {
  if (query !== null && query !== undefined && query !== "") {
    if (!isMes(query)) return { error: PERIODO_MESSAGES.mes };
    return { periodo: periodoDesde(query), aviso: null };
  }
  const param = parsePrimerMes(parametro);
  if (param) return { periodo: periodoDesde(param), aviso: null };
  return { periodo: periodoDesde(`${hoy.slice(0, 4)}-01`), aviso: PERIODO_MESSAGES.parametro };
}

/** Índice del mes en el período (0–11), o −1 si está afuera. */
export function indiceMes(periodo: Periodo, mes: string | null | undefined): number {
  if (!mes) return -1;
  return periodo.meses.indexOf(mes.slice(0, 7));
}
