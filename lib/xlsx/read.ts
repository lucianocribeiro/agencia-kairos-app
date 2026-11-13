import "server-only";

import { posix } from "node:path";
import { inflateRawSync } from "node:zlib";

/**
 * Lector mínimo de .xlsx (solo la primera hoja, valores; sin estilos ni fórmulas).
 * Sin dependencias: un .xlsx es un ZIP con XML. Se usa para los archivos de ARCA.
 *
 * Todo lo que viene del archivo se trata como hostil:
 * - ZIP: máximo de entradas; offsets y largos del directorio central y de los headers
 *   locales dentro del archivo; tamaño descomprimido igual al declarado (stored y
 *   deflate); límite por entrada y total; ZIP64 y cifrado rechazados. Solo se leen
 *   xl/workbook.xml, su .rels, la primera hoja (dentro de xl/worksheets/) y
 *   xl/sharedStrings.xml.
 * - Hoja: cada referencia de fila (≤ MAX_ROWS) y de columna (≤ MAX_COLS) se valida
 *   antes de reservar memoria; nada se dimensiona con valores sin validar.
 * - XML: entidades numéricas inválidas → error.
 * Cualquier problema (o excepción inesperada al leer) → XlsxError, que la API
 * responde como 400 con un mensaje en es-AR.
 */

export type XlsxCell = string | number | boolean | null;

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxError";
  }
}

export const XLSX_MESSAGES = {
  invalido: "El archivo no es un .xlsx válido.",
  muyGrande: "El contenido del archivo es demasiado grande.",
  referencia: "El archivo tiene una referencia de celda inválida (fila o columna fuera de rango).",
  demasiadasFilas: "El archivo tiene demasiadas filas para una importación.",
  xml: "El archivo tiene caracteres inválidos.",
} as const;

/** Zona de búsqueda de encabezados (30) + 1.000 filas de datos + margen. */
export const MAX_ROWS = 1100;
/** Columna BL. ARCA usa 30. */
export const MAX_COLS = 64;
export const MAX_ENTRIES = 1000;
export const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

interface Entry {
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const invalid = () => new XlsxError(XLSX_MESSAGES.invalido);

function readEntries(buf: Buffer): { entries: Map<string, Entry>; cdOffset: number } {
  // End of central directory: firma 0x06054b50, en los últimos 22 + 65535 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw invalid();
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw invalid(); // ZIP64
  if (count > MAX_ENTRIES) throw new XlsxError(XLSX_MESSAGES.muyGrande);
  const cdEnd = cdOffset + cdSize;
  if (cdOffset > eocd || cdEnd > eocd) throw invalid();

  const entries = new Map<string, Entry>();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cdEnd || buf.readUInt32LE(p) !== 0x02014b50) throw invalid();
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (next > cdEnd) throw invalid();
    const entry: Entry = {
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
    };
    if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.offset === 0xffffffff) throw invalid(); // ZIP64
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (!entries.has(name)) entries.set(name, entry);
    p = next;
  }
  return { entries, cdOffset };
}

class Extractor {
  #total = 0;
  constructor(
    private readonly buf: Buffer,
    private readonly entries: Map<string, Entry>,
    private readonly cdOffset: number,
  ) {}

  read(name: string): string | null {
    const e = this.entries.get(name);
    if (!e) return null;
    const { buf } = this;
    if (e.flags & 0x1) throw invalid(); // cifrado
    if (e.size > MAX_ENTRY_BYTES || this.#total + e.size > MAX_TOTAL_BYTES) throw new XlsxError(XLSX_MESSAGES.muyGrande);
    if (e.offset + 30 > this.cdOffset || buf.readUInt32LE(e.offset) !== 0x04034b50) throw invalid();
    const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
    const end = start + e.compressedSize;
    if (end > this.cdOffset) throw invalid();
    const data = buf.subarray(start, end);
    let out: Buffer;
    if (e.method === 0) {
      if (e.compressedSize !== e.size) throw invalid();
      out = Buffer.from(data);
    } else if (e.method === 8) {
      try {
        // +1: si sale más de lo declarado, se detecta abajo (en vez de truncar en silencio).
        out = inflateRawSync(data, { maxOutputLength: e.size + 1 });
      } catch {
        throw invalid();
      }
    } else throw invalid();
    if (out.length !== e.size) throw invalid();
    this.#total += out.length;
    return out.toString("utf8");
  }
}

const XML_ENTITY = /&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;

/** Caracteres permitidos en XML 1.0 (sin NUL, sin sustitutos, ≤ U+10FFFF). */
function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/** Entidades XML y los escapes `_xHHHH_` de OOXML (p. ej. saltos de línea en encabezados). */
export function decodeXml(text: string): string {
  return text
    .replace(XML_ENTITY, (_, ent: string) => {
      switch (ent) {
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "amp":
          return "&";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default: {
          const code = ent[1] === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
          if (!isXmlChar(code)) throw new XlsxError(XLSX_MESSAGES.xml);
          return String.fromCodePoint(code);
        }
      }
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Texto de un <si> o <is>: todos los <t>, sin las lecturas fonéticas (<rPh>). */
function richText(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  return [...clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((m) => decodeXml(m[1] ?? "")).join("");
}

const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];

/** "12" → 12 si es un entero ≥ 1 sin ceros a la izquierda; si no, null. */
function positiveInt(text: string): number | null {
  return /^[1-9]\d{0,6}$/.test(text) ? Number(text) : null;
}

/** "B12" → { col: 1, row: 12 }. Columnas A..BL (≤ MAX_COLS), filas 1..MAX_ROWS. Si no → XlsxError. */
export function parseCellRef(ref: string): { col: number; row: number } {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(ref);
  if (!m) throw new XlsxError(XLSX_MESSAGES.referencia);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = positiveInt(m[2]);
  if (col < 1 || col > MAX_COLS || row === null || row > MAX_ROWS) throw new XlsxError(XLSX_MESSAGES.referencia);
  return { col: col - 1, row };
}

/** Ruta canónica dentro del ZIP de un Target de xl/_rels/workbook.xml.rels (o null). */
export function resolveSheetTarget(target: string): string | null {
  const resolved = target.startsWith("/") ? posix.normalize(target.slice(1)) : posix.normalize(posix.join("xl", target));
  return /^xl\/worksheets\/[A-Za-z0-9_-]+\.xml$/.test(resolved) ? resolved : null;
}

function parseSheet(sheet: string, shared: readonly string[]): XlsxCell[][] {
  const rows: XlsxCell[][] = [];
  let lastRow = 0;
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = attr(rowMatch[1], "r");
    const rowNumber = r === undefined ? lastRow + 1 : positiveInt(r);
    if (rowNumber === null) throw new XlsxError(XLSX_MESSAGES.referencia);
    if (rowNumber > MAX_ROWS) throw new XlsxError(r === undefined ? XLSX_MESSAGES.demasiadasFilas : XLSX_MESSAGES.referencia);
    lastRow = rowNumber;
    const cells: XlsxCell[] = [];
    let next = 0;
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const ref = attr(attrs, "r");
      let col: number;
      if (ref === undefined) {
        col = next;
        if (col >= MAX_COLS) throw new XlsxError(XLSX_MESSAGES.referencia);
      } else {
        const parsed = parseCellRef(ref);
        if (parsed.row !== rowNumber) throw new XlsxError(XLSX_MESSAGES.referencia);
        col = parsed.col;
      }
      next = col + 1;
      const type = attr(attrs, "t") ?? "n";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: XlsxCell = null;
      if (type === "s") value = v !== undefined && /^\d{1,7}$/.test(v) ? (shared[Number(v)] ?? null) : null;
      else if (type === "inlineStr") value = richText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "str") value = v !== undefined ? decodeXml(v) : null;
      else if (type === "b") value = v === "1";
      else if (type === "e") value = null;
      else if (v !== undefined && v.trim() !== "") {
        const n = Number(v);
        value = Number.isFinite(n) ? n : decodeXml(v);
      }
      while (cells.length < col) cells.push(null); // col < MAX_COLS: acotado
      cells[col] = value;
    }
    while (rows.length < rowNumber - 1) rows.push([]); // rowNumber ≤ MAX_ROWS: acotado
    rows[rowNumber - 1] = cells;
  }
  return rows;
}

function read(file: Uint8Array): XlsxCell[][] {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw invalid();
  const { entries, cdOffset } = readEntries(buf);
  // Los datos de cada entrada tienen que estar antes del directorio central.
  const zip = new Extractor(buf, entries, cdOffset);

  const workbook = zip.read("xl/workbook.xml");
  if (!workbook) throw invalid();
  const firstSheet = /<sheet\b([^>]*)\/?>/.exec(workbook)?.[1] ?? "";
  const rid = attr(firstSheet, "r:id");
  let sheetPath = "xl/worksheets/sheet1.xml";
  const rels = zip.read("xl/_rels/workbook.xml.rels");
  if (rid && rels) {
    const rel = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]).find((a) => attr(a, "Id") === rid);
    const target = rel ? attr(rel, "Target") : undefined;
    if (target !== undefined) {
      const resolved = resolveSheetTarget(decodeXml(target));
      if (!resolved) throw invalid();
      sheetPath = resolved;
    }
  }
  const sheet = zip.read(sheetPath);
  if (!sheet) throw invalid();
  const sharedXml = zip.read("xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => richText(m[1] ?? "")) : [];
  return parseSheet(sheet, shared);
}

/**
 * Filas de la primera hoja: `rows[i][j]` = celda de la fila i+1, columna j+1.
 * Los huecos quedan en null. Números como number; texto como string.
 * Siempre lanza XlsxError (nunca otra excepción) si el archivo no se puede leer.
 */
export function readFirstSheet(file: Uint8Array): XlsxCell[][] {
  try {
    return read(file);
  } catch (err) {
    if (err instanceof XlsxError) throw err;
    throw invalid();
  }
}
