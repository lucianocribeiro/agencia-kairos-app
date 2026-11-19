import { readFileSync } from "node:fs";
import { decodePDFRawStream, PDFArray, PDFDocument, type PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { cuitSintetico } from "@/test/arca-fixture";
import { formatCuit } from "@/lib/cuit";
import { pdfText } from "@/test/pdf-text";
import type { FacturaDatos } from "./factura";
import { COPIAS, generarFacturaPdf, MARCA_HOMOLOGACION, QR_MODULE } from "./pdf";
import { qrMatrix, qrPayload, qrUrl, QR_BASE_URL } from "./qr";

const RECEPTOR = cuitSintetico("30", 71234567);
const assets = {
  regular: readFileSync("assets/fonts/sora/Sora-Regular.ttf"),
  semibold: readFileSync("assets/fonts/sora/Sora-SemiBold.ttf"),
  logo: readFileSync("assets/brand/logo-kairos-pdf.png"),
};

function datos(over: Partial<FacturaDatos> = {}): FacturaDatos & { numero: number; cae: string } {
  return {
    version: 1,
    ambiente: "Homologación",
    tipo: "Factura A",
    cbteTipo: 1,
    emisor: { razonSocial: "QA Empresa Emisora S.A.", cuit: "20409378472", domicilioComercial: "Av. QA 742, CABA", condicionIva: "IVA Responsable Inscripto", ingresosBrutos: "901-000000-1", inicioActividades: "2020-03-01", leyenda: "PAGO EN C.B.U. INFORMADA" },
    receptor: { clienteId: "recCLIENTE0000001", razonSocial: "QA Cliente RI S.A.", cuit: RECEPTOR, condicionIva: "Responsable Inscripto", condicionIvaReceptorId: 1, domicilioComercial: "Calle QA 123, Rosario", condicionVenta: "Cuenta Corriente" },
    mes: "2026-10",
    periodoDesde: "2026-10-01",
    periodoHasta: "2026-10-31",
    fechaEmision: "2026-11-19",
    vencimientoPago: "2026-12-19",
    puntoVenta: 1,
    detalle: { descripcion: "Servicios 10/2026: QR - Web", cantidad: 1, unidad: "unidades", precioUnitario: 123456789, bonificacion: 0, subtotal: 123456789, subtotalConIva: 149382715 },
    alicuota: 0.21,
    ivaId: 5,
    importes: { neto: 123456789, iva: 25925926, total: 149382715 },
    horas: [],
    proyectos: [],
    vencimientoCae: "2026-11-29",
    ...over,
    numero: 42,
    cae: "76123456789012",
  };
}

/** QR dibujado en la página 1: los cuadrados negros de lado QR_MODULE → matriz. */
async function qrDibujado(bytes: Uint8Array): Promise<boolean[][]> {
  const doc = await PDFDocument.load(bytes);
  const c = doc.getPages()[0].node.Contents()!;
  const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r) as PDFRawStream) : [c as unknown as PDFRawStream];
  const ops = streams.map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")).join("\n");
  const re = new RegExp(`0 0 0 rg\\n0 w\\n\\[\\] 0 d\\n1 0 0 1 ([\\d.]+) ([\\d.]+) cm\\n1 0 0 1 0 0 cm\\n1 0 0 1 0 0 cm\\n0 0 m\\n0 ${QR_MODULE} l\\n${QR_MODULE} ${QR_MODULE} l\\n${QR_MODULE} 0 l\\nh\\nf`, "g");
  const pts = [...ops.matchAll(re)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const size = Math.round((Math.max(...pts.map((p) => p.x)) - minX) / QR_MODULE) + 1;
  const m = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const p of pts) m[size - 1 - Math.round((p.y - minY) / QR_MODULE)][Math.round((p.x - minX) / QR_MODULE)] = true;
  return m;
}

describe("PDF de la Factura A (CC-F5-10)", () => {
  it("tres páginas: ORIGINAL, DUPLICADO, TRIPLICADO, con encabezado, receptor, detalle, totales y pie en cada una", async () => {
    const bytes = await generarFacturaPdf(datos(), assets);
    const { pages, numPages } = await pdfText(bytes);
    expect(numPages).toBe(3);
    for (const [i, copia] of COPIAS.entries()) {
      const t = pages[i].join("\n").replace(/[ \t]+/g, " ");
      expect(t).toContain(copia);
      for (const s of [
        "QA Empresa Emisora S.A.", "Razón Social:", "Domicilio Comercial: Av. QA 742, CABA", "Condición frente al IVA: IVA Responsable Inscripto",
        "A", "COD. 01", "PAGO EN C.B.U.", "INFORMADA", "FACTURA", "Punto de Venta: 00001", "Comp. Nro: 00000042", "Fecha de Emisión: 19/11/2026",
        "CUIT: 20-40937847-2", "Ingresos Brutos: 901-000000-1", "Fecha de Inicio de Actividades: 01/03/2020",
        "Período Facturado Desde: 01/10/2026", "Hasta: 31/10/2026", "Fecha de Vto. para el pago: 19/12/2026",
        `CUIT: ${formatCuit(RECEPTOR)}`, "Apellido y Nombre / Razón Social: QA Cliente RI S.A.", "Condición frente al IVA: IVA Responsable Inscripto", "Domicilio Comercial: Calle QA 123, Rosario", "Condición de venta: Cuenta Corriente",
        "Código", "Producto / Servicio", "Cantidad", "U. medida", "Precio Unit.", "% Bonif", "Subtotal", "Alícuota IVA", "Subtotal c/IVA",
        "Servicios 10/2026: QR - Web", "1,00", "unidades", "1.234.567,89", "0,00", "21%", "1.493.827,15",
        "Importe Neto Gravado: $", "IVA 27%: $", "IVA 21%: $", "IVA 10.5%: $", "IVA 5%: $", "IVA 2.5%: $", "IVA 0%: $", "Importe Otros Tributos: $", "Importe Total: $", "259.259,26",
        "Pág. 1/1", "CAE N°: 76123456789012", "Fecha de Vto. de CAE: 29/11/2026", "Comprobante Autorizado",
      ]) expect(t, s).toContain(s);
      expect(t).not.toMatch(/AFIP|ARCA logo/);
    }
  });

  it("marca de agua solo en Homologación; leyenda solo si está cargada", async () => {
    const homo = (await pdfText(await generarFacturaPdf(datos(), assets))).pages;
    homo.forEach((p) => expect(p.join(" ")).toContain(MARCA_HOMOLOGACION));
    const prod = (await pdfText(await generarFacturaPdf(datos({ ambiente: "Producción", emisor: { ...datos().emisor, cuit: "30700000007", leyenda: null } }), assets))).pages;
    prod.forEach((p) => {
      expect(p.join(" ")).not.toContain("HOMOLOGACIÓN");
      expect(p.join(" ")).not.toContain("PAGO EN C.B.U.");
    });
  });

  it("QR según ARCA: la URL con el JSON v1 en base64; los módulos dibujados son exactamente los de esa URL", async () => {
    const d = datos();
    const url = qrUrl(qrPayload(d));
    expect(url.startsWith(QR_BASE_URL)).toBe(true);
    expect(JSON.parse(Buffer.from(url.slice(QR_BASE_URL.length), "base64").toString("utf8"))).toEqual({
      ver: 1, fecha: "2026-11-19", cuit: 20409378472, ptoVta: 1, tipoCmp: 1, nroCmp: 42, importe: 1493827.15, moneda: "PES", ctz: 1, tipoDocRec: 80, nroDocRec: Number(RECEPTOR), tipoCodAut: "E", codAut: 76123456789012,
    });
    const drawn = await qrDibujado(await generarFacturaPdf(d, assets));
    expect(drawn).toEqual(qrMatrix(url));
    // Otra factura → otro QR (la comparación no es trivial).
    expect(drawn).not.toEqual(qrMatrix(qrUrl(qrPayload({ ...d, numero: 43 }))));
  });
});
