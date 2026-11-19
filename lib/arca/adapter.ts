/**
 * Adaptador de la respuesta de ARCA (Afip SDK, automatización «mis-comprobantes») a la hoja
 * (fila de encabezados + filas) que ya leen `findHeader` / `buildRows` (CC-F5-03). Puro.
 *
 * - Mapa explícito de encabezados: el nombre documentado por Afip SDK o el del parser
 *   (columns.ts) → la columna del parser. Así una respuesta que ya use los nombres del
 *   parser también funciona.
 * - Columnas obligatorias: las de `columnasObligatorias(kind, "arca")` (sin el detalle por
 *   alícuota ni, en Compras, los datos del receptor, que somos nosotros).
 * - Diagnóstico: si falta una columna obligatoria se informan solo NOMBRES de columnas,
 *   nunca valores.
 * - Los valores pasan tal cual (textos con coma decimal, números): las reglas de siempre
 *   los leen (parseNumero, parseFecha, codigoDeTipo), así la Clave ARCA es la misma que
 *   la de un .xlsx equivalente.
 */
import { COLUMNS, normalizeHeader, type Column, type Kind } from "@/lib/ventas-compras/columns";
import { columnasObligatorias, MAX_FILAS, type Cell } from "@/lib/ventas-compras/rows";

/** Nombre documentado por Afip SDK, cuando difiere del encabezado del parser. */
export const NOMBRES_ARCA: Readonly<Record<string, string>> = {
  fecha: "Fecha de Emisión",
  tipo: "Tipo de Comprobante",
  netoGravadoTotal: "Imp. Neto Gravado",
  netoNoGravado: "Imp. Neto No Gravado",
  opExentas: "Imp. Op. Exentas",
  totalIva: "IVA",
};

export const ARCA_ADAPTER_MESSAGES = {
  formato: "ARCA devolvió una respuesta con un formato inesperado. Probá de nuevo o subí el Excel.",
  sinComprobantes: "ARCA no devolvió comprobantes para ese período.",
  demasiadas: (n: number) => `ARCA devolvió ${n} comprobantes; el máximo por sincronización es ${MAX_FILAS}. Elegí un período más corto.`,
  faltanColumnas: (faltan: readonly string[], recibidas: readonly string[]) =>
    `Faltan columnas en la respuesta de ARCA: ${faltan.join(", ")} · Columnas recibidas: ${recibidas.length > 0 ? recibidas.join(", ") : "(ninguna)"}`,
} as const;

/** Nombre que se muestra de una columna (el de Afip SDK si difiere). */
export const nombreArca = (col: Column) => NOMBRES_ARCA[col.key] ?? col.header;

/** Columnas que la respuesta de ARCA tiene que traer (las mismas que exige findHeader con source "arca"). */
export const obligatoriasArca = (kind: Kind): readonly Column[] => columnasObligatorias(kind, "arca");

/** Nombre de columna recibido, seguro para mostrar: sin caracteres de control, acotado. */
function safeName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean;
}

const MAX_NOMBRES = 60;
const MAX_TEXTO = 1000;

function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > MAX_TEXTO ? value.slice(0, MAX_TEXTO) : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "?";
  if (typeof value === "boolean") return value;
  return "?"; // objeto o array: "Número inválido" en importes, texto "?" en el resto
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type ArcaRow = Record<string, Cell>;

export type AdaptResult =
  | {
      ok: true;
      /** Encabezados del parser + filas, lista para findHeader/buildRows con source "arca". */
      sheet: Cell[][];
      /** Las filas recibidas, solo con las columnas reconocidas (lo que viaja firmado). */
      rows: ArcaRow[];
    }
  | { ok: false; code: "formato" | "sin_comprobantes" | "demasiadas" | "faltan_columnas"; error: string };

/** Filas de Afip SDK (`data` del job) → hoja del parser. */
export function adaptArcaRows(kind: Kind, data: unknown): AdaptResult {
  if (!Array.isArray(data) || !data.every(isPlainObject)) return { ok: false, code: "formato", error: ARCA_ADAPTER_MESSAGES.formato };
  if (data.length === 0) return { ok: false, code: "sin_comprobantes", error: ARCA_ADAPTER_MESSAGES.sinComprobantes };
  if (data.length > MAX_FILAS) return { ok: false, code: "demasiadas", error: ARCA_ADAPTER_MESSAGES.demasiadas(data.length) };

  const recibidas: string[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        recibidas.push(key);
      }
    }
  }
  const byNormalized = new Map<string, string>();
  for (const key of recibidas) {
    const n = normalizeHeader(key);
    if (!byNormalized.has(n)) byNormalized.set(n, key);
  }

  // Columna del parser → clave recibida (nombre de Afip SDK o del parser).
  const keyFor = new Map<string, string>();
  for (const col of COLUMNS[kind]) {
    const aliases = [NOMBRES_ARCA[col.key], col.header].filter((x): x is string => !!x).map(normalizeHeader);
    const found = aliases.map((a) => byNormalized.get(a)).find((k) => k !== undefined);
    if (found !== undefined) keyFor.set(col.key, found);
  }
  const faltan = obligatoriasArca(kind).filter((c) => !keyFor.has(c.key)).map((c) => `«${nombreArca(c)}»`);
  if (faltan.length > 0) {
    const nombres = recibidas.slice(0, MAX_NOMBRES).map(safeName);
    if (recibidas.length > MAX_NOMBRES) nombres.push(`(y ${recibidas.length - MAX_NOMBRES} más)`);
    return { ok: false, code: "faltan_columnas", error: ARCA_ADAPTER_MESSAGES.faltanColumnas(faltan, nombres) };
  }

  const cols = COLUMNS[kind].filter((c) => keyFor.has(c.key));
  const rows: ArcaRow[] = data.map((row) => Object.fromEntries(cols.map((c) => [keyFor.get(c.key)!, toCell(row[keyFor.get(c.key)!])])));
  const sheet: Cell[][] = [cols.map((c) => c.header), ...rows.map((row) => cols.map((c) => row[keyFor.get(c.key)!] ?? null))];
  return { ok: true, sheet, rows };
}
