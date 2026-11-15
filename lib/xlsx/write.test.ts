import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { readFirstSheet } from "./read";
import { colName, writeXlsx, xmlSafe } from "./write";

/** Lee una entrada del ZIP que arma writeXlsx (headers locales simples, deflate). */
function entry(zip: Buffer, name: string): string {
  let p = 0;
  while (zip.readUInt32LE(p) === 0x04034b50) {
    const size = zip.readUInt32LE(p + 18);
    const nameLen = zip.readUInt16LE(p + 26);
    const extra = zip.readUInt16LE(p + 28);
    const n = zip.toString("utf8", p + 30, p + 30 + nameLen);
    const start = p + 30 + nameLen + extra;
    if (n === name) return inflateRawSync(zip.subarray(start, start + size)).toString("utf8");
    p = start + size;
  }
  throw new Error(`no está ${name}`);
}

describe("writeXlsx", () => {
  const bytes = writeXlsx({
    name: "Resultados por proyecto: [x]",
    widths: [30, 14, 14],
    rows: [
      [{ v: "Título", s: "title" }],
      ["Período: 01/2026 a 12/2026"],
      [],
      [{ v: "Categoría", s: "bold" }, { v: "01/2026", s: "bold" }, { v: "Total", s: "bold" }],
      ["Ingresos <& \"servicios\">", 1234.56, { v: -0.5, s: "moneyBold" }],
      ["Margen %", { v: 0.125, s: "pct" }, null],
      ["Ñandú · áéí", 1e-2, 0],
    ],
  });

  it("lo lee el lector del repo: texto como texto y números como números", () => {
    const rows = readFirstSheet(bytes);
    expect(rows[0]).toEqual(["Título"]);
    expect(rows[2]).toEqual([]);
    expect(rows[4]).toEqual(['Ingresos <& "servicios">', 1234.56, -0.5]);
    expect(rows[5]).toEqual(["Margen %", 0.125]);
    expect(rows[6]).toEqual(["Ñandú · áéí", 0.01, 0]);
    for (const v of rows[4].slice(1)) expect(typeof v).toBe("number");
  });

  it("formatos #,##0.00 y 0.0%, anchos de columna y nombre de hoja saneado", () => {
    const styles = entry(bytes, "xl/styles.xml");
    expect(styles).toContain('formatCode="#,##0.00"');
    expect(styles).toContain('formatCode="0.0%"');
    const sheet = entry(bytes, "xl/worksheets/sheet1.xml");
    expect(sheet).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
    expect(sheet).toContain('<c r="B5" s="2"><v>1234.56</v></c>'); // importe: #,##0.00
    expect(sheet).toContain('<c r="C5" s="3"><v>-0.5</v></c>'); // importe en negrita
    expect(sheet).toContain('<c r="B6" s="4"><v>0.125</v></c>'); // porcentaje: 0.0%
    expect(sheet).not.toMatch(/t="inlineStr"><is><t[^>]*>1234/); // ningún número como texto
    expect(entry(bytes, "xl/workbook.xml")).toContain('name="Resultados por proyecto   x"');
  });

  it("columnas AA, AZ, BA", () => {
    expect([0, 25, 26, 51, 52].map(colName)).toEqual(["A", "Z", "AA", "AZ", "BA"]);
  });

  it("rechaza números no finitos", () => {
    expect(() => writeXlsx({ name: "x", widths: [], rows: [[Number.NaN]] })).toThrow(RangeError);
  });
});

describe("writeXlsx: solo XML 1.0 válido (regresión)", () => {
  const INVALIDOS: [string, string][] = [
    ...Array.from({ length: 32 }, (_, i) => i)
      .filter((i) => i !== 0x09 && i !== 0x0a && i !== 0x0d)
      .map((i): [string, string] => [`U+${i.toString(16).toUpperCase().padStart(4, "0")}`, String.fromCharCode(i)]),
    ["U+FFFE", "\uFFFE"],
    ["U+FFFF", "\uFFFF"],
    ["surrogate alto suelto", "\uD83D"],
    ["surrogate bajo suelto", "\uDE00"],
    ["bajo antes del alto", "\uDE00\uD83D"],
  ];

  it.each(INVALIDOS)("%s: se saca de celdas y nombre de hoja; el archivo se lee", (_label, ch) => {
    const bytes = writeXlsx({ name: `Hoja${ch}A`, widths: [10], rows: [[`a${ch}b`], [`🎉${ch}ñ`]] });
    expect(readFirstSheet(bytes)).toEqual([["ab"], ["🎉ñ"]]);
    expect(entry(bytes, "xl/workbook.xml")).toContain('<sheet name="HojaA" ');
    for (const part of ["xl/workbook.xml", "xl/worksheets/sheet1.xml"]) expect(entry(bytes, part).includes(ch), part).toBe(false);
  });

  it("todos juntos (separados por «.»), más tab/LF/CR y emoji que quedan", () => {
    // Separados: un surrogate alto suelto seguido de uno bajo suelto formarían un par válido (que sí queda).
    const todos = INVALIDOS.map(([, c]) => c).join(".");
    const puntos = ".".repeat(INVALIDOS.length - 1);
    const bytes = writeXlsx({ name: `${todos}Socios 🎉`, widths: [10], rows: [[`x${todos}\ty\nz\r😀`]] });
    expect(readFirstSheet(bytes)).toEqual([[`x${puntos}\ty\nz\r😀`]]);
    expect(xmlSafe(`${todos}ok🎉`)).toBe(`${puntos}ok🎉`);
    expect(xmlSafe("\uD83D\uDE00")).toBe("😀"); // par válido
  });

  it("el recorte a 31 caracteres del nombre no deja un surrogate partido", () => {
    const bytes = writeXlsx({ name: `${"a".repeat(30)}🎉`, widths: [], rows: [["x"]] });
    expect(readFirstSheet(bytes)).toEqual([["x"]]);
    expect(xmlSafe(`${"a".repeat(30)}🎉`.slice(0, 31))).toBe("a".repeat(30));
  });
});
