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

/**
 * Otros nombres aceptados por columna, además del encabezado del parser (que siempre se acepta).
 * Primero el nombre REAL de la respuesta de Afip SDK (Ventas, t=E, verificado en la primera
 * sincronización real, CC-F5-07); después los nombres documentados que ya se aceptaban.
 * Las columnas «IVA X%» y «Total IVA» llegan con el mismo nombre que el parser.
 */
export const NOMBRES_ARCA: Readonly<Record<string, readonly string[]>> = {
  fecha: ["Fecha de Emisión"],
  tipo: ["Tipo de Comprobante"],
  netoGravIva0: ["Imp. Neto Gravado IVA 0%"],
  netoGravIva25: ["Imp. Neto Gravado IVA 2,5%"],
  netoGravIva5: ["Imp. Neto Gravado IVA 5%"],
  netoGravIva105: ["Imp. Neto Gravado IVA 10,5%"],
  netoGravIva21: ["Imp. Neto Gravado IVA 21%"],
  netoGravIva27: ["Imp. Neto Gravado IVA 27%"],
  netoGravadoTotal: ["Imp. Neto Gravado Total", "Imp. Neto Gravado"],
  netoNoGravado: ["Imp. Neto No Gravado"],
  opExentas: ["Imp. Op. Exentas"],
  totalIva: ["IVA"],
};

export const ARCA_ADAPTER_MESSAGES = {
  formato: "ARCA devolvió una respuesta con un formato inesperado. Probá de nuevo o subí el Excel.",
  sinComprobantes: "ARCA no devolvió comprobantes para ese período.",
  datoInvalido: (columna: string) => `Dato inválido en la respuesta de ARCA (columna «${columna}»).`,
  demasiadas: (n: number) => `ARCA devolvió ${n} comprobantes; el máximo por sincronización es ${MAX_FILAS}. Elegí un período más corto.`,
  faltanColumnas: (faltan: readonly string[], recibidas: readonly string[]) =>
    `Faltan columnas en la respuesta de ARCA: ${faltan.join(", ")} · Columnas recibidas: ${recibidas.length > 0 ? recibidas.join(", ") : "(ninguna)"}`,
} as const;

/** Todos los nombres aceptados de una columna, en orden de preferencia (sin repetidos). */
export const nombresAceptados = (col: Column): string[] => [...new Set([...(NOMBRES_ARCA[col.key] ?? []), col.header])];

/** Nombre que se muestra de una columna (el real de Afip SDK si difiere). */
export const nombreArca = (col: Column) => nombresAceptados(col)[0];

/** Columnas que la respuesta de ARCA tiene que traer (las mismas que exige findHeader con source "arca"). */
export const obligatoriasArca = (kind: Kind): readonly Column[] => columnasObligatorias(kind, "arca");

/** Nombre de columna recibido, seguro para mostrar: sin caracteres de control, acotado. */
function safeName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean;
}

const MAX_NOMBRES = 60;
const MAX_TEXTO = 1000;
/** Respuesta hostil (CC-F5-04 F-06): como máximo 100 claves distintas y de ≤ 200 caracteres. */
export const MAX_CLAVES = 100;
export const MAX_LARGO_CLAVE = 200;
/** Claves que nunca se leen (contaminación de prototipos). */
const CLAVES_PROTOTIPO: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

const isPrimitive = (v: unknown): v is string | number | boolean | null | undefined =>
  v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** Valor primitivo → celda. (Los no primitivos se marcan antes como error de fila.) */
function toCell(value: string | number | boolean | null | undefined): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > MAX_TEXTO ? value.slice(0, MAX_TEXTO) : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return value;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Una fila tal como vino de Afip SDK, solo con las columnas reconocidas (lo que viaja firmado). */
export type ArcaRow = Record<string, unknown>;

export type AdaptResult =
  | {
      ok: true;
      /** Encabezados del parser + filas, lista para findHeader/buildRows con source "arca". */
      sheet: Cell[][];
      /** Las filas recibidas, solo con las columnas reconocidas y los valores tal cual (lo que viaja firmado). */
      rows: ArcaRow[];
      /** N.º de comprobante (1..N) → motivo, para las filas con un dato no primitivo. */
      invalidas: ReadonlyMap<number, string>;
    }
  | { ok: false; code: "formato" | "sin_comprobantes" | "demasiadas" | "faltan_columnas"; error: string };

const formato = (): AdaptResult => ({ ok: false, code: "formato", error: ARCA_ADAPTER_MESSAGES.formato });

/** Filas de Afip SDK (`data` del job) → hoja del parser. */
export function adaptArcaRows(kind: Kind, data: unknown): AdaptResult {
  if (!Array.isArray(data) || !data.every(isPlainObject)) return formato();
  if (data.length === 0) return { ok: false, code: "sin_comprobantes", error: ARCA_ADAPTER_MESSAGES.sinComprobantes };
  if (data.length > MAX_FILAS) return { ok: false, code: "demasiadas", error: ARCA_ADAPTER_MESSAGES.demasiadas(data.length) };

  const recibidas: string[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    for (const key of Object.keys(row)) {
      if (CLAVES_PROTOTIPO.has(key) || seen.has(key)) continue;
      if (key.length > MAX_LARGO_CLAVE) return formato();
      seen.add(key);
      recibidas.push(key);
      if (recibidas.length > MAX_CLAVES) return formato();
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
    const aliases = nombresAceptados(col).map(normalizeHeader);
    const found = aliases.map((a) => byNormalized.get(a)).find((k) => k !== undefined);
    if (found !== undefined) keyFor.set(col.key, found);
  }
  // Cada columna faltante con todos sus nombres aceptados: «Imp. Neto Gravado Total» / «Imp. Neto Gravado» / «Neto Gravado Total».
  const faltan = obligatoriasArca(kind).filter((c) => !keyFor.has(c.key)).map((c) => nombresAceptados(c).map((n) => `«${n}»`).join(" / "));
  if (faltan.length > 0) {
    const nombres = recibidas.slice(0, MAX_NOMBRES).map(safeName);
    if (recibidas.length > MAX_NOMBRES) nombres.push(`(y ${recibidas.length - MAX_NOMBRES} más)`);
    return { ok: false, code: "faltan_columnas", error: ARCA_ADAPTER_MESSAGES.faltanColumnas(faltan, nombres) };
  }

  const cols = COLUMNS[kind].filter((c) => keyFor.has(c.key));
  const invalidas = new Map<number, string>();
  const rows: ArcaRow[] = [];
  const cells: Cell[][] = [];
  data.forEach((row, i) => {
    const raw: ArcaRow = {};
    const line: Cell[] = [];
    for (const c of cols) {
      const key = keyFor.get(c.key)!;
      const value = Object.hasOwn(row, key) ? row[key] : undefined;
      raw[key] = value === undefined ? null : value;
      if (isPrimitive(value)) line.push(toCell(value));
      else {
        // Objeto o array: error de fila antes de armar ninguna Clave ARCA (CC-F5-04 F-05).
        if (!invalidas.has(i + 1)) invalidas.set(i + 1, ARCA_ADAPTER_MESSAGES.datoInvalido(nombreArca(c)));
        line.push(null);
      }
    }
    rows.push(raw);
    cells.push(line);
  });
  return { ok: true, sheet: [cols.map((c) => c.header), ...cells], rows, invalidas };
}
