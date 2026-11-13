import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { buildXlsx, xlsxParts, zip } from "@/test/xlsx-fixture";
import { decodeXml, MAX_COLS, MAX_ROWS, parseCellRef, readFirstSheet, resolveSheetTarget, XLSX_MESSAGES, XlsxError } from "./read";

const rows = [["Título"], null, ["Fecha", "Imp.\nTotal", "A & B <c>"], [46310, 1210.5, "texto"], [null, -3, "  con espacios  "]];

/** .xlsx con el <sheetData> escrito a mano. */
const withSheet = (sheetXml: string) => zip(xlsxParts([], { sheetXml }), false);
const expectXlsxError = (file: Uint8Array, message: string | RegExp) => {
  expect(() => readFirstSheet(file)).toThrow(XlsxError);
  expect(() => readFirstSheet(file)).toThrow(message);
};

describe("readFirstSheet · lectura", () => {
  it.each([
    ["inlineStr + deflate", { sharedStrings: false }],
    ["sharedStrings + deflate", { sharedStrings: true }],
    ["sharedStrings + stored", { sharedStrings: true, store: true }],
  ])("%s", (_n, opts) => {
    const sheet = readFirstSheet(buildXlsx(rows, opts));
    expect(sheet[0]).toEqual(["Título"]);
    expect(sheet[1]).toEqual([]);
    expect(sheet[2]).toEqual(["Fecha", "Imp.\r\nTotal", "A & B <c>"]);
    expect(sheet[3]).toEqual([46310, 1210.5, "texto"]);
    expect(sheet[4]).toEqual([null, -3, "  con espacios  "]);
  });

  it("sin atributos r (filas y celdas): posiciones consecutivas", () => {
    const sheet = readFirstSheet(withSheet('<row><c t="inlineStr"><is><t>a</t></is></c><c><v>2</v></c></row><row><c><v>3</v></c></row>'));
    expect(sheet).toEqual([["a", 2], [3]]);
  });

  it("decodifica entidades XML y escapes _xHHHH_", () => {
    expect(decodeXml("a &amp; b &lt;c&gt; &#233; &#xF1; &#x1F600; _x000D_")).toBe("a & b <c> é ñ 😀 \r");
  });
});

describe("referencias de fila y columna (fix 1: validadas antes de reservar memoria)", () => {
  it.each(["999999999", "0", "-1", "1.5", "abc", "", "01", String(MAX_ROWS + 1)])('fila r="%s" → XlsxError', (r) => {
    expectXlsxError(withSheet(`<row r="${r}"><c><v>1</v></c></row>`), XLSX_MESSAGES.referencia);
  });

  it.each(["ZZZZ1", "BM1", "A0", "A-1", "A1.5", "1A", "a1", `A${MAX_ROWS + 1}`, "A999999999"])('celda r="%s" → XlsxError', (ref) => {
    expectXlsxError(withSheet(`<row r="1"><c r="${ref}"><v>1</v></c></row>`), XLSX_MESSAGES.referencia);
  });

  it("la celda tiene que estar en su fila", () => {
    expectXlsxError(withSheet('<row r="2"><c r="A3"><v>1</v></c></row>'), XLSX_MESSAGES.referencia);
  });

  it("límites exactos: fila 1.100 y columna BL (64) se aceptan", () => {
    const sheet = readFirstSheet(withSheet(`<row r="${MAX_ROWS}"><c r="BL${MAX_ROWS}"><v>7</v></c></row>`));
    expect(sheet).toHaveLength(MAX_ROWS);
    expect(sheet[MAX_ROWS - 1]).toHaveLength(MAX_COLS);
    expect(sheet[MAX_ROWS - 1][MAX_COLS - 1]).toBe(7);
    expect(parseCellRef("BL1")).toEqual({ col: 63, row: 1 });
  });

  it("sin r: más de 1.100 filas o de 64 columnas → XlsxError", () => {
    expectXlsxError(withSheet("<row><c><v>1</v></c></row>".repeat(MAX_ROWS + 1)), XLSX_MESSAGES.demasiadasFilas);
    expectXlsxError(withSheet(`<row>${"<c><v>1</v></c>".repeat(MAX_COLS + 1)}</row>`), XLSX_MESSAGES.referencia);
  });
});

/** Busca el header central de `name` en un ZIP armado con zip(). */
function centralOf(file: Buffer, name: string): number {
  const at = file.lastIndexOf(Buffer.from(name));
  return at - 46;
}
const eocdOf = (file: Buffer) => file.length - 22;

describe("ZIP (fix 2)", () => {
  it("más de 1.000 entradas → XlsxError", () => {
    const many = [...xlsxParts(rows), ...Array.from({ length: 1000 }, (_, i) => ({ name: `x/${i}.txt`, data: Buffer.from("x") }))];
    expectXlsxError(zip(many, true), XLSX_MESSAGES.muyGrande);
  });

  it("más de 60 MB descomprimidos en total (aunque cada entrada esté bajo 40 MB) → XlsxError", () => {
    const pad = " ".repeat(35 * 1024 * 1024);
    const parts = xlsxParts([], { sheetXml: `<row r="1"><c r="A1"><v>1</v></c></row>${pad}` });
    parts.push({ name: "xl/sharedStrings.xml", data: Buffer.from(`<sst>${pad}</sst>`) });
    expectXlsxError(zip(parts, false), XLSX_MESSAGES.muyGrande);
  });

  it("una entrada que declara más de 40 MB no se descomprime", () => {
    const file = Buffer.from(buildXlsx(rows, { store: true }));
    file.writeUInt32LE(0x7fffffff, centralOf(file, "xl/worksheets/sheet1.xml") + 24);
    expectXlsxError(file, XLSX_MESSAGES.muyGrande);
  });

  it.each([
    ["directorio central fuera del archivo", (f: Buffer) => f.writeUInt32LE(f.length + 100, eocdOf(f) + 16)],
    ["tamaño del directorio central fuera del archivo", (f: Buffer) => f.writeUInt32LE(f.length, eocdOf(f) + 12)],
    ["header local fuera del archivo", (f: Buffer) => f.writeUInt32LE(f.length + 10, centralOf(f, "xl/workbook.xml") + 42)],
    ["header local que no es un header local", (f: Buffer) => f.writeUInt32LE(5, centralOf(f, "xl/workbook.xml") + 42)],
    ["datos comprimidos que se pasan del archivo", (f: Buffer) => f.writeUInt32LE(f.length, centralOf(f, "xl/workbook.xml") + 20)],
    ["largo de nombre que se sale del directorio", (f: Buffer) => f.writeUInt16LE(0xffff, centralOf(f, "xl/workbook.xml") + 28)],
    ["ZIP64", (f: Buffer) => f.writeUInt32LE(0xffffffff, centralOf(f, "xl/workbook.xml") + 24)],
    ["cifrado", (f: Buffer) => f.writeUInt16LE(1, centralOf(f, "xl/workbook.xml") + 8)],
    ["método de compresión desconocido", (f: Buffer) => f.writeUInt16LE(12, centralOf(f, "xl/workbook.xml") + 10)],
  ])("%s → XlsxError", (_n, tamper) => {
    for (const store of [true, false]) {
      const file = Buffer.from(store ? buildXlsx(rows, { store: true }) : buildXlsx(rows));
      tamper(file);
      expect(() => readFirstSheet(file)).toThrow(XlsxError);
    }
  });

  it.each([
    ["stored: declara menos de lo que hay", true, -1],
    ["stored: declara más de lo que hay", true, +1],
    ["deflate: declara menos de lo que sale", false, -1],
    ["deflate: declara más de lo que sale", false, +1],
  ])("tamaño descomprimido ≠ declarado (%s) → XlsxError", (_n, store, delta) => {
    const file = Buffer.from(store ? buildXlsx(rows, { store: true }) : buildXlsx(rows));
    const at = centralOf(file, "xl/worksheets/sheet1.xml") + 24;
    file.writeUInt32LE(file.readUInt32LE(at) + delta, at);
    expectXlsxError(file, XLSX_MESSAGES.invalido);
  });

  it("deflate corrupto → XlsxError", () => {
    const parts = xlsxParts(rows);
    const file = Buffer.from(zip(parts, false));
    const sheetData = deflateRawSync(parts.find((p) => p.name === "xl/worksheets/sheet1.xml")!.data);
    const start = file.indexOf(sheetData);
    file.fill(0xff, start, start + 8);
    expect(() => readFirstSheet(file)).toThrow(XlsxError);
  });

  it("Targets de la hoja: solo dentro de xl/worksheets/, resueltos canónicamente", () => {
    expect(resolveSheetTarget("worksheets/sheet1.xml")).toBe("xl/worksheets/sheet1.xml");
    expect(resolveSheetTarget("/xl/worksheets/sheet1.xml")).toBe("xl/worksheets/sheet1.xml");
    expect(resolveSheetTarget("worksheets/../worksheets/sheet2.xml")).toBe("xl/worksheets/sheet2.xml");
    expect(resolveSheetTarget("../xl/worksheets/sheet1.xml")).toBe("xl/worksheets/sheet1.xml");
    for (const bad of ["../../etc/passwd", "worksheets/../sharedStrings.xml", "/docProps/app.xml", "worksheets/sub/sheet1.xml", "worksheets/sheet1.xml.rels", "worksheets/..\\sheet1.xml"]) {
      expect(resolveSheetTarget(bad), bad).toBeNull();
    }
    expectXlsxError(zip(xlsxParts(rows, { relsTarget: "../../etc/passwd" }), false), XLSX_MESSAGES.invalido);
    expectXlsxError(zip(xlsxParts(rows, { relsTarget: "sharedStrings.xml" }), false), XLSX_MESSAGES.invalido);
    expect(readFirstSheet(zip(xlsxParts(rows, { relsTarget: "/xl/worksheets/sheet1.xml" }), false))[3]).toEqual([46310, 1210.5, "texto"]);
  });

  it("lo que no es un .xlsx", () => {
    expect(() => readFirstSheet(new Uint8Array([1, 2, 3]))).toThrow(XlsxError);
    expect(() => readFirstSheet(Buffer.from("PK\u0003\u0004 no es un zip de verdad, solo empieza igual"))).toThrow(XlsxError);
    expect(() => readFirstSheet(buildXlsx(rows).subarray(0, 200))).toThrow(XlsxError);
  });
});

describe("XML (fix 4)", () => {
  it.each(["&#x110000;", "&#0;", "&#xD800;", "&#xDFFF;", "&#xFFFE;", "&#1;", "&#99999999;"])("entidad inválida %s → XlsxError", (ent) => {
    expect(() => decodeXml(`a${ent}b`)).toThrow(XlsxError);
    expectXlsxError(withSheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>a${ent}</t></is></c></row>`), XLSX_MESSAGES.xml);
  });

  it("entidades válidas en el límite", () => {
    expect(decodeXml("&#9;&#xA;&#xD;&#x20;&#xD7FF;&#xE000;&#xFFFD;&#x10000;&#x10FFFF;")).toHaveLength(11);
  });

  it("cualquier otra excepción al leer → XlsxError (nunca otra cosa)", () => {
    // EOCD con datos sin sentido al final de un archivo que empieza como ZIP
    const junk = Buffer.alloc(200, 0x41);
    junk.writeUInt32LE(0x04034b50, 0);
    junk.writeUInt32LE(0x06054b50, 200 - 22);
    junk.writeUInt16LE(3, 200 - 22 + 10);
    expect(() => readFirstSheet(junk)).toThrow(XlsxError);
  });
});
