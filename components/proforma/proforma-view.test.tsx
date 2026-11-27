import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FacturaEstado } from "@/lib/factura/factura";
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

/** Filas (encabezado incluido) de la tabla bajo el título `titulo`, como texto por celda. */
function filasTabla(html: string, titulo: string): string[][] {
  const desde = html.indexOf(`>${titulo}</h2>`);
  if (desde < 0) return [];
  const tabla = html.slice(desde, html.indexOf("</table>", desde));
  return [...tabla.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim()));
}

const facturaEstado: FacturaEstado = {
  ambiente: "Homologación",
  configurada: true,
  elegible: false,
  motivos: ["Cargá el tipo de cambio para convertir los importes en USD."],
  hoy: "2026-11-19",
  importes: { neto: 0, iva: 0, total: 0 },
  tipoCambio: null,
  conversion: null,
  proformaTotales: [],
  difiere: false,
  alicuota: 0.21,
  detalleSugerido: "",
  comprobantes: [],
};

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

  it("mixta con TC: «Totales por moneda» con 3 filas (ARS, USD y «Total en pesos (TC …)»), sin «Equivalente en pesos»; PDF con ?tc=", () => {
    const d = aplicarTipoCambio(proforma(["ARS", "USD"]), 1050.25);
    const s = html({ data: d, tc: "1050,25" });
    expect(filasTabla(s, "Totales por moneda")).toEqual([
      ["Moneda", "Subtotal", "IVA 21 %", "Total"],
      ["ARS", "1.851,86", "388,89", "2.240,75"],
      ["USD", "56,00", "11,76", "67,76"],
      ["Total en pesos (TC 1.050,25)", "60.665,86", "12.739,83", "73.405,69"], // 1.851,86 + 56,00 × 1.050,25
    ]);
    expect(s).not.toContain("Equivalente en pesos");
    expect(s).not.toContain("Tipo de cambio:");
    expect(s).not.toContain("Totales por moneda (");
    expect(s).toMatch(/name="tc"[^>]*value="1\.050,25"/);
    expect(pdfHref(s)).toBe("/api/admin/proforma/pdf?cliente=recCLIENTE1000000&mes=2026-10&tc=1.050%2C25");
  });

  it("solo USD con TC: 2 filas, «USD» y «ARS (TC …)»", () => {
    const s = html({ data: aplicarTipoCambio(proforma(["USD"]), 1000) });
    expect(filasTabla(s, "Totales por moneda")).toEqual([
      ["Moneda", "Subtotal", "IVA 21 %", "Total"],
      ["USD", "56,00", "11,76", "67,76"],
      ["ARS (TC 1.000)", "56.000,00", "11.760,00", "67.760,00"],
    ]);
    expect(s).not.toContain("Equivalente en pesos");
  });

  it("sin TC: exactamente las filas nativas (mixta y solo USD)", () => {
    expect(filasTabla(html({ data: proforma(["ARS", "USD"]) }), "Totales por moneda").slice(1)).toEqual([
      ["ARS", "1.851,86", "388,89", "2.240,75"],
      ["USD", "56,00", "11,76", "67,76"],
    ]);
    expect(filasTabla(html({ data: proforma(["USD"]) }), "Totales por moneda").slice(1)).toEqual([["USD", "56,00", "11,76", "67,76"]]);
  });

  it("orden: la tarjeta del TC va DEBAJO de «Factura ARCA»; sin «Factura ARCA», en su lugar; sin USD, no está", () => {
    const d = aplicarTipoCambio(proforma(["USD"]), 1000);
    const s = html({ data: d, factura: facturaEstado });
    const iFactura = s.indexOf('id="factura-arca"');
    const iTc = s.indexOf('data-seccion="tipo-cambio"');
    const iTotales = s.indexOf(">Resumen por proyecto<");
    expect(iFactura).toBeGreaterThan(0);
    expect(iTc).toBeGreaterThan(iFactura);
    expect(iTotales).toBeGreaterThan(iTc);
    // Sin la sección (falló la carga): la tarjeta sigue, en el mismo lugar (después de los datos del cliente, antes de las tablas).
    const sinFactura = html({ data: d, factura: null });
    expect(sinFactura).not.toContain('id="factura-arca"');
    const j = sinFactura.indexOf('data-seccion="tipo-cambio"');
    expect(j).toBeGreaterThan(sinFactura.indexOf("</dl>"));
    expect(j).toBeLessThan(sinFactura.indexOf(">Resumen por proyecto<"));
    // Sin USD: no hay tarjeta (aunque haya «Factura ARCA»).
    const ars = html({ data: proforma(["ARS"]), factura: facturaEstado });
    expect(ars).toContain('id="factura-arca"');
    expect(ars).not.toContain('data-seccion="tipo-cambio"');
  });

  it("TC inválido: el mensaje es-AR junto al campo y la proforma sin conversión", () => {
    const s = html({ data: proforma(["ARS", "USD"]), tc: "abc", tcError: TC_MESSAGES.invalido });
    expect(s).toContain(TC_MESSAGES.invalido);
    expect(s).toContain('aria-invalid="true"');
    expect(s).toMatch(/name="tc"[^>]*value="abc"/);
    expect(s).not.toContain("Equivalente en pesos");
  });
});
