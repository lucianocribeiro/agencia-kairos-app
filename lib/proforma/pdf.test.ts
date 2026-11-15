import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { pdfText } from "@/test/pdf-text";
import { generarProformaPdf, wrapText } from "./pdf";
import { calcularProforma, type HoraP } from "./proforma";

const assets = {
  regular: readFileSync("assets/fonts/sora/Sora-Regular.ttf"),
  semibold: readFileSync("assets/fonts/sora/Sora-SemiBold.ttf"),
  logo: readFileSync("assets/brand/logo-kairos-pdf.png"),
};
const CLIENTE = { id: "recCLIENTE1000000", nombre: "QA Cliente Ñandú «Uno»", sigla: "QA", cuit: "30711111118", condicionIva: "Monotributista" };
const LARGA = "Supercalifragilisticoespialidosoextraordinariamentelargo";

function datos(n: number) {
  const horas: HoraP[] = Array.from({ length: n }, (_, i) => ({
    id: `recHORA${String(i).padStart(10, "0")}`,
    fecha: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`,
    colaborador: "recUSUARIO0000000",
    proyecto: "recPROYECTO000000",
    tarea: `Tarea ${String(i).padStart(3, "0")} ${"con texto largo ".repeat(i % 5)}${i % 7 === 0 ? LARGA : ""}`,
    desde: 32400,
    hasta: 36000 + (i % 30) * 60,
    facturable: true,
    mesAFacturar: null,
  }));
  return calcularProforma({
    cliente: CLIENTE,
    mes: "2026-10",
    alicuota: 0.21,
    proyectos: [{ id: "recPROYECTO000000", codigo: "QA - Web", cliente: CLIENTE.id, valorHora: 1234.57, moneda: "ARS" }],
    horas,
    colaboradores: new Map([["recUSUARIO0000000", "Ana Admin"]]),
  });
}

describe("PDF de la proforma", () => {
  it("A4, varias páginas: encabezado de la tabla repetido, «Página X de Y» y fecha de generación en cada una", async () => {
    const d = datos(70);
    const bytes = await generarProformaPdf(d, assets, new Date("2026-11-14T15:30:00Z"));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    for (const p of doc.getPages()) expect(p.getSize()).toEqual({ width: 595.28, height: 841.89 });
    expect(doc.getTitle()).toBe("Proforma de horas · QA Cliente Ñandú «Uno» · 10/2026");
    const { pages, numPages } = await pdfText(bytes);
    pages.forEach((lines, i) => {
      const txt = lines.join("\n");
      expect(txt, `página ${i + 1}`).toContain("Proforma de horas");
      expect(txt, `página ${i + 1}`).toContain(`Generado el 14/11/2026 12:30   Página ${i + 1} de ${numPages}`);
      if (i > 0) expect(lines.some((l) => l.startsWith("Fecha   Colaborador   Proyecto   Tarea   Horas   Valor hora   Moneda   Importe")), `encabezado en página ${i + 1}`).toBe(true);
    });
    // todas las filas del detalle están, con su tarea (que corta línea dentro de la celda)
    const plano = pages.flat().join(" ").replace(/\s+/g, " ");
    for (const r of d.detalle) expect(plano).toContain(r.tarea.slice(0, 9));
    expect(plano).toContain("QA Cliente Ñandú «Uno»");
  });

  it("wrapText: corta por palabras y parte una palabra que no entra", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrapText(`uno dos tres ${LARGA}`, font, 10, 100);
    expect(lines[0]).toBe("uno dos tres");
    expect(lines.slice(1).join("")).toBe(LARGA);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(100);
    expect(wrapText("", font, 10, 100)).toEqual([""]);
  });
});
