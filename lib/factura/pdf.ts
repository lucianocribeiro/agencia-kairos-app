import "server-only";

import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, type PDFFont } from "pdf-lib";

import { formatCuit } from "@/lib/cuit";
import { formatNumber, isoToDisplayDate } from "@/lib/format";
import { wrapText, type PdfAssets } from "@/lib/proforma/pdf";
import { moneyAr, n8, pv5, type FacturaDatos } from "./factura";
import { qrMatrix, qrPayload, qrUrl } from "./qr";

/**
 * PDF de la Factura A (CC-F5-10), con la estructura de la representación impresa de ARCA:
 * tres páginas (ORIGINAL, DUPLICADO, TRIPLICADO), encabezado con el emisor, el recuadro de la
 * letra «A» / «COD. 01», el período, el receptor, el detalle, los totales por alícuota y el pie
 * con el QR, el CAE y su vencimiento. Sin logo de ARCA. Importes es-AR con coma decimal.
 * Siempre se arma desde el snapshot guardado (FacturaDatos), nunca desde datos actuales.
 * Homologación: marca de agua «HOMOLOGACIÓN · SIN VALIDEZ FISCAL» en cada página.
 */

export const COPIAS = ["ORIGINAL", "DUPLICADO", "TRIPLICADO"] as const;
export const MARCA_HOMOLOGACION = "HOMOLOGACIÓN · SIN VALIDEZ FISCAL";
/** Lado de un módulo del QR (pt). Los tests reconstruyen el QR por este tamaño. */
export const QR_MODULE = 1.15;

const A4 = { w: 595.28, h: 841.89 };
const M = 28;
const CW = A4.w - 2 * M;
const ink = rgb(0.07, 0.07, 0.09);
const line = rgb(0.2, 0.2, 0.22);
const band = rgb(0.9, 0.91, 0.93);
const black = rgb(0, 0, 0);

const fecha = (iso: string | null) => (iso ? isoToDisplayDate(iso) : "");
const pct = (rate: number) => `${formatNumber(rate * 100, { maxDecimals: 2 })}%`;

const charsets = new WeakMap<PDFFont, Set<number>>();
function safe(font: PDFFont, s: string): string {
  let set = charsets.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charsets.set(font, set);
  }
  return [...s].map((ch) => (set.has(ch.codePointAt(0)!) ? ch : "?")).join("");
}

export async function generarFacturaPdf(d: FacturaDatos & { numero: number; cae: string }, assets: PdfAssets, generado = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(assets.regular, { subset: true });
  const semi = await doc.embedFont(assets.semibold, { subset: true });
  doc.setTitle(`Factura A ${pv5(d.puntoVenta)}-${n8(d.numero)}`);
  doc.setAuthor(d.emisor.razonSocial);
  doc.setCreator("Agencia Kairos · App interna");
  doc.setProducer("pdf-lib");
  doc.setCreationDate(generado);
  doc.setModificationDate(generado);

  const matrix = qrMatrix(qrUrl(qrPayload(d)));

  for (const copia of COPIAS) {
    const page = doc.addPage([A4.w, A4.h]);
    const text = (s: string, x: number, y: number, size: number, font: PDFFont = reg, color = ink) => page.drawText(safe(font, s), { x, y, size, font, color });
    const center = (s: string, cx: number, y: number, size: number, font: PDFFont = reg) => text(s, cx - font.widthOfTextAtSize(safe(font, s), size) / 2, y, size, font);
    const right = (s: string, xr: number, y: number, size: number, font: PDFFont = reg) => text(s, xr - font.widthOfTextAtSize(safe(font, s), size), y, size, font);
    const box = (x: number, y: number, w: number, h: number, fill?: typeof band) => page.drawRectangle({ x, y, width: w, height: h, borderColor: line, borderWidth: 0.8, color: fill });
    const label = (k: string, v: string, x: number, y: number, size = 8.5, max = 260) => {
      text(k, x, y, size, semi);
      const kw = semi.widthOfTextAtSize(safe(semi, k), size) + 3;
      const lines = wrapText(safe(reg, v), reg, size, max - kw);
      lines.slice(0, 2).forEach((l, i) => text(l, x + kw, y - i * (size + 2), size, reg));
      return lines.length > 1 ? size + 2 : 0;
    };

    let y = A4.h - M;
    // Copia
    box(M, y - 20, CW, 20);
    center(copia, A4.w / 2, y - 14, 11, semi);
    y -= 20;

    // Encabezado: emisor | letra | comprobante
    const headH = 128;
    box(M, y - headH, CW, headH);
    const mid = A4.w / 2;
    // La línea vertical arranca debajo de la letra, el código y la leyenda.
    page.drawLine({ start: { x: mid, y: y - (d.emisor.leyenda ? 86 : 60) }, end: { x: mid, y: y - headH }, thickness: 0.8, color: line });
    // Letra
    const lb = 44;
    box(mid - lb / 2, y - lb, lb, lb, rgb(1, 1, 1));
    center("A", mid, y - 32, 28, semi);
    center("COD. 01", mid, y - lb - 9, 7, semi);
    if (d.emisor.leyenda) {
      const ley = wrapText(safe(semi, d.emisor.leyenda), semi, 6.5, 92);
      ley.slice(0, 2).forEach((l, i) => center(l, mid, y - lb - 18 - i * 8, 6.5, semi));
    }
    // Emisor
    const lx = M + 8;
    text(d.emisor.razonSocial, lx, y - 26, 13, semi);
    let ly = y - 60;
    ly -= label("Razón Social: ", d.emisor.razonSocial, lx, ly, 8.5, mid - 60 - lx) + 13;
    ly -= label("Domicilio Comercial: ", d.emisor.domicilioComercial, lx, ly, 8.5, mid - 8 - lx) + 13;
    label("Condición frente al IVA: ", d.emisor.condicionIva, lx, ly, 8.5, mid - 8 - lx);
    // Comprobante
    const rx = mid + 34;
    text("FACTURA", rx, y - 26, 16, semi);
    let ry = y - 46;
    label("Punto de Venta: ", pv5(d.puntoVenta), rx, ry);
    label("Comp. Nro: ", n8(d.numero), rx + 108, ry);
    ry -= 14;
    label("Fecha de Emisión: ", fecha(d.fechaEmision), rx, ry);
    ry -= 18;
    label("CUIT: ", formatCuit(d.emisor.cuit) || d.emisor.cuit, rx, ry);
    ry -= 13;
    label("Ingresos Brutos: ", d.emisor.ingresosBrutos, rx, ry);
    ry -= 13;
    label("Fecha de Inicio de Actividades: ", fecha(d.emisor.inicioActividades), rx, ry);
    y -= headH;

    // Período
    const perH = 20;
    box(M, y - perH, CW, perH);
    label("Período Facturado Desde: ", fecha(d.periodoDesde), M + 8, y - 13);
    label("Hasta: ", fecha(d.periodoHasta), M + 200, y - 13);
    label("Fecha de Vto. para el pago: ", fecha(d.vencimientoPago), M + 330, y - 13);
    y -= perH + 4;

    // Receptor
    const recH = 58;
    box(M, y - recH, CW, recH);
    label("CUIT: ", formatCuit(d.receptor.cuit) || d.receptor.cuit, M + 8, y - 14);
    label("Apellido y Nombre / Razón Social: ", d.receptor.razonSocial, M + 160, y - 14, 8.5, CW - 160);
    label("Condición frente al IVA: ", `IVA ${d.receptor.condicionIva}`, M + 8, y - 30, 8.5, 270);
    label("Domicilio Comercial: ", d.receptor.domicilioComercial, M + 280, y - 30, 8.5, CW - 280);
    label("Condición de venta: ", d.receptor.condicionVenta, M + 8, y - 46);
    y -= recH + 6;

    // Detalle
    const cols: { t: string; w: number; r?: boolean }[] = [
      { t: "Código", w: 34 },
      { t: "Producto / Servicio", w: 140 },
      { t: "Cantidad", w: 40, r: true },
      { t: "U. medida", w: 46 },
      { t: "Precio Unit.", w: 60, r: true },
      { t: "% Bonif", w: 34, r: true },
      { t: "Subtotal", w: 60, r: true },
      { t: "Alícuota IVA", w: 56, r: true },
      { t: "Subtotal c/IVA", w: CW - 470, r: true },
    ];
    const hh = 16;
    box(M, y - hh, CW, hh, band);
    let x = M;
    for (const c of cols) {
      if (c.r) right(c.t, x + c.w - 3, y - 11, 7.2, semi);
      else text(c.t, x + 3, y - 11, 7.2, semi);
      x += c.w;
    }
    y -= hh;
    const desc = wrapText(safe(reg, d.detalle.descripcion), reg, 8, cols[1].w - 6);
    const cells = ["", "", "1,00", d.detalle.unidad, moneyAr(d.detalle.precioUnitario), "0,00", moneyAr(d.detalle.subtotal), pct(d.alicuota), moneyAr(d.detalle.subtotalConIva)];
    x = M;
    cols.forEach((c, i) => {
      if (i === 1) desc.forEach((l, j) => text(l, x + 3, y - 12 - j * 10, 8));
      else if (c.r) right(cells[i], x + c.w - 3, y - 12, 8);
      else text(cells[i], x + 3, y - 12, 8);
      x += c.w;
    });

    // Totales (abajo a la derecha), sobre el pie
    const footH = 100;
    const totalsTop = M + footH + 10 + 128;
    const tx = M + CW - 250;
    box(tx, M + footH + 10, 250, 128);
    const milesimas = Math.round(d.alicuota * 1000);
    const ivaDe = (m: number) => (m === milesimas ? d.importes.iva : 0);
    const filas: [string, number, boolean?][] = [
      ["Importe Neto Gravado: $", d.importes.neto],
      ["IVA 27%: $", ivaDe(270)],
      ["IVA 21%: $", ivaDe(210)],
      ["IVA 10.5%: $", ivaDe(105)],
      ["IVA 5%: $", ivaDe(50)],
      ["IVA 2.5%: $", ivaDe(25)],
      ["IVA 0%: $", 0],
      ["Importe Otros Tributos: $", 0],
      ["Importe Total: $", d.importes.total, true],
    ];
    filas.forEach(([k, v, bold], i) => {
      const yy = totalsTop - 14 - i * 12.6;
      const f = bold ? semi : reg;
      right(k, tx + 160, yy, bold ? 9 : 8.2, semi);
      right(moneyAr(v), tx + 242, yy, bold ? 9 : 8.2, f);
    });

    // Pie: QR · página · CAE
    box(M, M, CW, footH);
    const size = matrix.length * QR_MODULE;
    const qx = M + 8;
    const qy = M + (footH - size) / 2;
    matrix.forEach((row, my) =>
      row.forEach((dark, mx) => {
        if (dark) page.drawRectangle({ x: qx + mx * QR_MODULE, y: qy + (matrix.length - 1 - my) * QR_MODULE, width: QR_MODULE, height: QR_MODULE, color: black });
      }),
    );
    text("Comprobante Autorizado", qx + size + 12, M + footH - 24, 10, semi);
    center("Pág. 1/1", A4.w / 2 + 40, M + 14, 8, semi);
    right(`CAE N°: ${d.cae}`, M + CW - 10, M + footH - 24, 9, semi);
    right(`Fecha de Vto. de CAE: ${fecha(d.vencimientoCae)}`, M + CW - 10, M + footH - 38, 9, semi);

    if (d.ambiente === "Homologación") {
      const s = 30;
      const w = semi.widthOfTextAtSize(MARCA_HOMOLOGACION, s);
      const ang = 35;
      const rad = (ang * Math.PI) / 180;
      page.drawText(MARCA_HOMOLOGACION, {
        x: A4.w / 2 - (w / 2) * Math.cos(rad),
        y: A4.h / 2 - (w / 2) * Math.sin(rad),
        size: s,
        font: semi,
        color: rgb(0.85, 0.1, 0.1),
        opacity: 0.22,
        rotate: degrees(ang),
      });
    }
  }
  return doc.save();
}
