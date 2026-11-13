import "server-only";

import { inflateRawSync } from "node:zlib";

/**
 * Lector mínimo de .xlsx (solo la primera hoja, valores; sin estilos ni fórmulas).
 * Sin dependencias: un .xlsx es un ZIP con XML. Se usa para los archivos de ARCA.
 *
 * Seguridad: solo se descomprimen las 4 entradas necesarias, con límite de tamaño
 * declarado y real (`maxOutputLength`), así un ZIP bomba no consume memoria. ZIP64
 * y cifrado se rechazan.
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
} as const;

const MAX_ENTRY_BYTES = 40 * 1024 * 1024;

interface Entry {
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  offset: number;
}

function readEntries(buf: Buffer): Map<string, Entry> {
  // End of central directory: firma 0x06054b50, en los últimos 22 + 65535 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError(XLSX_MESSAGES.invalido);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new XlsxError(XLSX_MESSAGES.invalido); // ZIP64
  const entries = new Map<string, Entry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError(XLSX_MESSAGES.invalido);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen).replace(/\\/g, "/");
    entries.set(name.replace(/^\//, ""), { method, flags, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extract(buf: Buffer, entries: Map<string, Entry>, name: string): string | null {
  const e = entries.get(name);
  if (!e) return null;
  if (e.flags & 0x1) throw new XlsxError(XLSX_MESSAGES.invalido); // cifrado
  if (e.size > MAX_ENTRY_BYTES) throw new XlsxError(XLSX_MESSAGES.muyGrande);
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw new XlsxError(XLSX_MESSAGES.invalido);
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.compressedSize);
  let out: Buffer;
  try {
    if (e.method === 0) out = Buffer.from(data);
    else if (e.method === 8) out = inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    else throw new XlsxError(XLSX_MESSAGES.invalido);
  } catch (err) {
    if (err instanceof XlsxError) throw err;
    throw new XlsxError(XLSX_MESSAGES.invalido);
  }
  return out.toString("utf8");
}

/** Entidades XML y los escapes `_xHHHH_` de OOXML (p. ej. saltos de línea en encabezados). */
export function decodeXml(text: string): string {
  return text
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, ent: string) => {
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
        default:
          return String.fromCodePoint(ent[1] === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10));
      }
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Texto de un <si> o <is>: todos los <t>, sin las lecturas fonéticas (<rPh>). */
function richText(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  return [...clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((m) => decodeXml(m[1] ?? "")).join("");
}

const attr = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Filas de la primera hoja: `rows[i][j]` = celda de la fila i+1, columna j+1.
 * Los huecos quedan en null. Números como number; texto como string.
 */
export function readFirstSheet(file: Uint8Array): XlsxCell[][] {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new XlsxError(XLSX_MESSAGES.invalido);
  const entries = readEntries(buf);

  const workbook = extract(buf, entries, "xl/workbook.xml");
  if (!workbook) throw new XlsxError(XLSX_MESSAGES.invalido);
  const firstSheet = /<sheet\b([^>]*)\/?>/.exec(workbook)?.[1] ?? "";
  const rid = attr(firstSheet, "r:id");
  let sheetPath = "xl/worksheets/sheet1.xml";
  const rels = extract(buf, entries, "xl/_rels/workbook.xml.rels");
  if (rid && rels) {
    const rel = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]).find((a) => attr(a, "Id") === rid);
    const target = rel ? attr(rel, "Target") : undefined;
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = extract(buf, entries, sheetPath);
  if (!sheet) throw new XlsxError(XLSX_MESSAGES.invalido);

  const sharedXml = extract(buf, entries, "xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => richText(m[1] ?? "")) : [];

  const rows: XlsxCell[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(attr(rowMatch[1], "r") ?? rows.length + 1);
    const cells: XlsxCell[] = [];
    let next = 0;
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const ref = attr(attrs, "r");
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = attr(attrs, "t") ?? "n";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: XlsxCell = null;
      if (type === "s") value = v !== undefined ? (shared[Number(v)] ?? null) : null;
      else if (type === "inlineStr") value = richText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "str") value = v !== undefined ? decodeXml(v) : null;
      else if (type === "b") value = v === "1";
      else if (type === "e") value = null;
      else if (v !== undefined && v.trim() !== "") {
        const n = Number(v);
        value = Number.isFinite(n) ? n : decodeXml(v);
      }
      while (cells.length < col) cells.push(null);
      cells[col] = value;
    }
    while (rows.length < rowNumber - 1) rows.push([]);
    rows[rowNumber - 1] = cells;
  }
  return rows;
}
