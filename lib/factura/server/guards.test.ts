import { describe, expect, it } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { claveDeComprobante, filtroHoraEnFactura, filtroVentaFacturada } from "./guards";

const F = TABLES.comprobantesEmitidos.fields;

describe("guardas de borrado · fórmulas (CC-F5-13)", () => {
  it("Ventas: Producción + Autorizada, sin la clave (se compara en código)", () => {
    expect(filtroVentaFacturada().toString()).toBe(`AND({${F.ambiente}} = "Producción", {${F.estado}} = "Autorizada")`);
  });

  it("Horas: Producción + En proceso/Incierta/Autorizada + FIND del ID en Datos, con el valor escapado", () => {
    expect(filtroHoraEnFactura("recAAAAAAAAAAAAA1").toString()).toBe(
      `AND({${F.ambiente}} = "Producción", OR({${F.estado}} = "En proceso", {${F.estado}} = "Incierta", {${F.estado}} = "Autorizada"), FIND("recAAAAAAAAAAAAA1", {${F.datos}} & ""))`,
    );
    // Un valor con comillas, barra y salto de línea nunca rompe la fórmula.
    expect(filtroHoraEnFactura('rec"x\\y\nz').toString()).toContain(`FIND("rec\\"x\\\\y\\nz", {${F.datos}} & "")`);
  });

  it("clave del comprobante: la guardada; si está vacía, la derivada del snapshot válido; si no, null", () => {
    const datos = (over: Record<string, unknown> = {}) => JSON.stringify({ version: 1, ambiente: "Producción", tipo: "Factura A", cbteTipo: 1, emisor: {}, receptor: { cuit: "30712345671" }, importes: {}, detalle: {}, puntoVenta: 7, horas: [], numero: 12, cae: "70000000000012", vencimientoCae: "2026-11-29", ...over });
    expect(claveDeComprobante({ [F.claveArca]: " 1|7|99|30712345671 ", [F.datos]: datos() })).toBe("1|7|99|30712345671");
    expect(claveDeComprobante({ [F.claveArca]: "", [F.datos]: datos() })).toBe("1|7|12|30712345671");
    expect(claveDeComprobante({ [F.datos]: datos({ cae: null }) })).toBeNull();
    expect(claveDeComprobante({ [F.datos]: "{roto" })).toBeNull();
  });
});
