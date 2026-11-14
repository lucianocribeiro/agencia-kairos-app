import "server-only";

import { crc32, deflateRawSync } from "node:zlib";

/**
 * Escritor mínimo de .xlsx (una hoja), sin dependencias: ZIP con deflate de
 * `node:zlib` + SpreadsheetML. Los números se guardan como números (nunca texto)
 * con formato `#,##0.00` (importes) o `0.0%` (porcentajes); un Excel en es-AR los
 * muestra con sus separadores. Texto como inlineStr. Lo lee lib/xlsx/read.ts.
 */

export type XlsxStyle = "text" | "bold" | "title" | "money" | "moneyBold" | "pct" | "pctBold";

export type XlsxWriteCell = null | string | number | { v: string | number; s?: XlsxStyle };

export interface XlsxSheet {
  /** Nombre de la hoja (se recorta a 31 caracteres y se sacan []:*?/\). */
  name: string;
  /** Ancho de cada columna (en caracteres). */
  widths: number[];
  rows: XlsxWriteCell[][];
}

/** Índice en cellXfs de styles.xml. */
const STYLE_INDEX: Record<XlsxStyle, number> = { text: 0, bold: 1, money: 2, moneyBold: 3, pct: 4, pctBold: 5, title: 6 };

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const esc = (s: string) =>
  s
    // Fuera los caracteres de control que XML 1.0 no admite.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function cellXml(cell: XlsxWriteCell, ref: string): string {
  if (cell === null) return "";
  const { v, s } = typeof cell === "object" ? cell : { v: cell, s: undefined };
  const style = s ? STYLE_INDEX[s] : typeof v === "number" ? STYLE_INDEX.money : 0;
  const sAttr = style ? ` s="${style}"` : "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new RangeError(`Número no finito en ${ref}`);
    return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
  }
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.map((c, i) => cellXml(c, `${colName(i)}${r + 1}`)).join("");
      return cells ? `<row r="${r + 1}">${cells}</row>` : "";
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const body = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Una hoja → bytes del .xlsx. */
export function writeXlsx(sheet: XlsxSheet): Buffer {
  const name = esc(sheet.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim() || "Hoja1");
  const parts: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": STYLES,
    "xl/worksheets/sheet1.xml": sheetXml(sheet),
  };
  return zip(Object.entries(parts).map(([n, d]) => ({ name: n, data: Buffer.from(d, "utf8") })));
}
