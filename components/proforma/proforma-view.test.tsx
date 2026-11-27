import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { calcularProforma, type HoraP, type ProyectoP } from "@/lib/proforma/proforma";
import { aplicarTipoCambio, TC_MESSAGES } from "@/lib/proforma/tipo-cambio";
import { ProformaView } from "./proforma-view";

/** CC-F5-21: la pantalla de la Proforma con y sin tipo de cambio. */
const CLIENTE = { id: "recCLIENTE1000000", nombre: "QA Cliente", sigla: "QA", cuit: null, condicionIva: null };
const clientes = [{ id: CLIENTE.id, nombre: CLIENTE.nombre }];

function proforma(monedas: ("ARS" | "USD")[]) {
  const proyectos: ProyectoP[] = monedas.map((m, i) => ({ id: `recPROYECTO00000${i}`, codigo: `QA - ${m}`, cliente: CLIENTE.id, valorHora: m === "USD" ? 37.33 : 1234.57, moneda: m }));
  const horas: HoraP[] = monedas.map((_, i) => ({ id: `recHORA000000000${i}`, fecha: "2026-10-05", colaborador: null, proyecto: `recPROYECTO00000${i}`, tarea: "x", desde: 32400, hasta: 37800, facturable: true, mesAFacturar: null }));
  return calcularProforma({ cliente: CLIENTE, mes: "2026-10", alicuota: 0.21, proyectos, horas, colaboradores: new Map() });
}

const html = (props: Partial<Parameters<typeof ProformaView>[0]> & { data: ReturnType<typeof proforma> }) =>
  renderToStaticMarkup(<ProformaView clientes={clientes} cliente={CLIENTE.id} mes="2026-10" error={null} {...props} />);

const pdfHref = (s: string) => /href="(\/api\/admin\/proforma\/pdf[^"]*)"/.exec(s)?.[1]?.replaceAll("&amp;", "&");

describe("Proforma · tipo de cambio (pantalla)", () => {
  it("sin USD: ni el campo de TC ni el bloque; con un TC en la URL, la misma pantalla", () => {
    const d = proforma(["ARS"]);
    const sin = html({ data: d });
    expect(sin).not.toContain(TC_MESSAGES.label);
    expect(sin).not.toContain("Equivalente en pesos");
    expect(html({ data: aplicarTipoCambio(d, 1050.25), tc: "1.050,25" })).toBe(sin);
  });

  it("con USD y sin TC: el campo de TC (GET con cliente y mes), sin bloque; el resto como hoy", () => {
    const d = proforma(["ARS", "USD"]);
    const s = html({ data: d });
    expect(s).toContain(TC_MESSAGES.label);
    expect(s).toMatch(/<input[^>]*name="tc"/);
    expect(s).toMatch(/<input type="hidden" name="cliente" value="recCLIENTE1000000"/);
    expect(s).toMatch(/<input type="hidden" name="mes" value="2026-10"/);
    expect(s).not.toContain("Equivalente en pesos");
    expect(s).not.toContain("Tipo de cambio:");
    expect(pdfHref(s)).toBe("/api/admin/proforma/pdf?cliente=recCLIENTE1000000&mes=2026-10");
  });

  it("con USD y TC válido: «Tipo de cambio: …», el bloque «Equivalente en pesos» (con la parte en ARS si es mixta) y el PDF con ?tc=", () => {
    const d = aplicarTipoCambio(proforma(["ARS", "USD"]), 1050.25);
    const s = html({ data: d, tc: "1050,25" });
    expect(s).toContain("Tipo de cambio: 1.050,25");
    expect(s).toContain("Equivalente en pesos");
    expect(s).toContain("Parte en ARS (neto)");
    expect(s).toContain("USD 56,00 a TC 1.050,25 (neto)");
    expect(s).toContain("58.814,00"); // 56,00 × 1.050,25
    // El bloque USD de siempre sigue (totales por moneda).
    expect(s).toContain("56,00");
    expect(s).toMatch(/name="tc"[^>]*value="1\.050,25"/);
    expect(pdfHref(s)).toBe("/api/admin/proforma/pdf?cliente=recCLIENTE1000000&mes=2026-10&tc=1.050%2C25");
  });

  it("solo USD: sin la línea de la parte en ARS", () => {
    const s = html({ data: aplicarTipoCambio(proforma(["USD"]), 1000) });
    expect(s).toContain("Equivalente en pesos");
    expect(s).not.toContain("Parte en ARS (neto)");
  });

  it("TC inválido: el mensaje es-AR junto al campo y la proforma sin conversión", () => {
    const s = html({ data: proforma(["ARS", "USD"]), tc: "abc", tcError: TC_MESSAGES.invalido });
    expect(s).toContain(TC_MESSAGES.invalido);
    expect(s).toContain('aria-invalid="true"');
    expect(s).toMatch(/name="tc"[^>]*value="abc"/);
    expect(s).not.toContain("Equivalente en pesos");
  });
});
