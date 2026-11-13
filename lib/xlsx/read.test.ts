import { describe, expect, it } from "vitest";

import { buildXlsx } from "@/test/xlsx-fixture";
import { decodeXml, readFirstSheet, XlsxError } from "./read";

describe("readFirstSheet", () => {
  const rows = [["Título"], null, ["Fecha", "Imp.\nTotal", "A & B <c>"], [46310, 1210.5, "texto"], [null, -3, "  con espacios  "]];

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

  it("decodifica entidades XML y escapes _xHHHH_", () => {
    expect(decodeXml("a &amp; b &lt;c&gt; &#233; &#xF1; _x000D_")).toBe("a & b <c> é ñ \r");
  });

  it("rechaza lo que no es un .xlsx", () => {
    expect(() => readFirstSheet(new Uint8Array([1, 2, 3]))).toThrow(XlsxError);
    expect(() => readFirstSheet(Buffer.from("PK\u0003\u0004 no es un zip de verdad, solo empieza igual"))).toThrow(XlsxError);
    const truncated = buildXlsx(rows).subarray(0, 200);
    expect(() => readFirstSheet(truncated)).toThrow(XlsxError);
  });

  it("ZIP bomba: una entrada que declara más de 40 MB no se descomprime", () => {
    const file = Buffer.from(buildXlsx(rows, { store: true }));
    // Busca la entrada central de la hoja y le pone un tamaño descomprimido enorme.
    const name = Buffer.from("xl/worksheets/sheet1.xml");
    let p = file.lastIndexOf(name) - 46;
    while (p > 0 && file.readUInt32LE(p) !== 0x02014b50) p--;
    file.writeUInt32LE(0x7fffffff, p + 24);
    expect(() => readFirstSheet(file)).toThrow(/demasiado grande/);
  });
});
