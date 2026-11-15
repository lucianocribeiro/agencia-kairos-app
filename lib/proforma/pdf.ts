import "server-only";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

import { formatDateTime, formatNumber, isoToDisplayDate } from "@/lib/format";
import { formatHours } from "@/lib/horas/time";
import type { ProformaData } from "./proforma";

/**
 * PDF de la proforma (pdf-lib, sin dependencias nativas). A4 vertical, márgenes de 15 mm,
 * fuente Sora (OFL) embebida como subset. Identidad Kairos sobre fondo blanco: texto
 * oscuro, acento #0DE8E1 solo en bandas, encabezados de tabla y filetes; el logo es claro,
 * así que va sobre una banda negra compacta arriba de cada página.
 */

export interface PdfAssets {
  regular: Uint8Array;
  semibold: Uint8Array;
  /** Logo claro (PNG con transparencia). */
  logo: Uint8Array;
}

const A4 = { w: 595.28, h: 841.89 };
const M = 42.52; // 15 mm
const CW = A4.w - 2 * M;
const BAND = 46;
const FOOTER = 26;

const C = {
  ink: rgb(0x03 / 255, 0x07 / 255, 0x12 / 255), // #030712
  text: rgb(0x11 / 255, 0x18 / 255, 0x27 / 255), // #111827
  accent: rgb(0x0d / 255, 0xe8 / 255, 0xe1 / 255), // #0DE8E1
  muted: rgb(0x9c / 255, 0xa3 / 255, 0xaf / 255), // #9CA3AF
  rule: rgb(0xe5 / 255, 0xe7 / 255, 0xeb / 255), // separador neutro de filas
  black: rgb(0, 0, 0),
  white: rgb(1, 1, 1),
};

const money = (cents: number | null) => (cents === null ? "" : formatNumber(cents / 100, { decimals: 2 }));
const valor = (v: number | null) => (v === null ? "" : formatNumber(v, { decimals: 2 }));

interface Col {
  label: string;
  width: number;
  align?: "left" | "right";
  wrap?: boolean;
}

/** Corta un texto en líneas que entran en `max` (palabras; una palabra larga se parte por caracteres). */
export function wrapText(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= max) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      line = "";
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > max) {
        let n = rest.length - 1;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > max) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

/** Sora no tiene glifos para todo: se reemplazan los caracteres que la fuente no puede dibujar. */
const charsets = new WeakMap<PDFFont, Set<number>>();
function safe(font: PDFFont, s: string): string {
  let set = charsets.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charsets.set(font, set);
  }
  return [...s].map((ch) => (set.has(ch.codePointAt(0)!) ? ch : ch === "\t" ? " " : "?")).join("");
}

export async function generarProformaPdf(d: ProformaData, assets: PdfAssets, generado = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(assets.regular, { subset: true });
  const semi = await doc.embedFont(assets.semibold, { subset: true });
  const logo: PDFImage = await doc.embedPng(assets.logo);
  doc.setTitle(`Proforma de horas · ${d.cliente.nombre} · ${d.mesLabel}`);
  doc.setAuthor("Agencia Kairos");
  doc.setCreator("Agencia Kairos · App interna");
  doc.setProducer("pdf-lib");
  doc.setCreationDate(generado);
  doc.setModificationDate(generado);

  let page!: PDFPage;
  let y = 0;
  const text = (s: string, x: number, yy: number, size: number, font: PDFFont, color = C.text) => page.drawText(safe(font, s), { x, y: yy, size, font, color });
  const right = (s: string, xRight: number, yy: number, size: number, font: PDFFont, color = C.text) =>
    text(s, xRight - font.widthOfTextAtSize(safe(font, s), size), yy, size, font, color);

  function newPage() {
    page = doc.addPage([A4.w, A4.h]);
    page.drawRectangle({ x: 0, y: A4.h - BAND, width: A4.w, height: BAND, color: C.black });
    page.drawRectangle({ x: 0, y: A4.h - BAND - 2, width: A4.w, height: 2, color: C.accent });
    const lh = 24;
    const lw = (logo.width / logo.height) * lh;
    page.drawImage(logo, { x: M, y: A4.h - BAND + (BAND - lh) / 2, width: lw, height: lh });
    right("Proforma de horas", A4.w - M, A4.h - BAND / 2 - 5, 14, semi, C.white);
    y = A4.h - BAND - 2 - 22;
  }
  const bottom = M + FOOTER;
  const ensure = (h: number) => {
    if (y - h < bottom) {
      newPage();
      return true;
    }
    return false;
  };

  function section(title: string) {
    ensure(40);
    text(title, M, y, 11.5, semi, C.ink);
    page.drawRectangle({ x: M, y: y - 5, width: CW, height: 1, color: C.accent });
    y -= 20;
  }

  /** Tabla con encabezado repetido en cada página; las celdas `wrap` ocupan varias líneas. */
  function table(cols: Col[], rows: string[][], opts: { boldRows?: Set<number> } = {}) {
    const size = 8.5;
    const lh = 11;
    const pad = 4;
    const header = () => {
      const hh = lh + 2 * pad;
      page.drawRectangle({ x: M, y: y - hh, width: CW, height: hh, color: C.accent });
      let x = M;
      for (const c of cols) {
        const ty = y - pad - 8.5;
        if (c.align === "right") right(c.label, x + c.width - pad, ty, 8, semi, C.ink);
        else text(c.label, x + pad, ty, 8, semi, C.ink);
        x += c.width;
      }
      y -= hh;
    };
    ensure(lh * 2 + 4 * pad);
    header();
    rows.forEach((row, ri) => {
      const font = opts.boldRows?.has(ri) ? semi : reg;
      const cells = cols.map((c, i) => (c.wrap ? wrapText(safe(font, row[i] ?? ""), font, size, c.width - 2 * pad) : [safe(font, row[i] ?? "")]));
      const lines = Math.max(...cells.map((l) => l.length));
      const rh = lines * lh + 2 * pad;
      if (ensure(rh)) header();
      let x = M;
      cols.forEach((c, i) => {
        cells[i].forEach((ln, li) => {
          const ty = y - pad - 8.5 - li * lh;
          if (c.align === "right") right(ln, x + c.width - pad, ty, size, font);
          else text(ln, x + pad, ty, size, font);
        });
        x += c.width;
      });
      y -= rh;
      page.drawRectangle({ x: M, y, width: CW, height: 0.5, color: C.rule });
    });
    y -= 16;
  }

  newPage();

  // Datos del encabezado
  const datos: [string, string][] = [
    ["Cliente", d.cliente.nombre],
    ["CUIT", d.cliente.cuit],
    ["Condición IVA", d.cliente.condicionIva],
    ["Mes a facturar", d.mesLabel],
  ];
  const colW = CW / 2;
  datos.forEach(([label, value], i) => {
    const x = M + (i % 2) * colW;
    const yy = y - Math.floor(i / 2) * 30;
    text(label, x, yy, 8, reg, C.muted);
    const lines = wrapText(safe(semi, value), semi, 10.5, colW - 12);
    text(lines[0], x, yy - 13, 10.5, semi, C.ink);
  });
  y -= 74;

  if (d.incompleta) {
    const msg = "La proforma está incompleta: hay proyectos sin valor hora o moneda (no suman en los totales).";
    const lines = wrapText(msg, semi, 9, CW - 16);
    const h = lines.length * 12 + 10;
    page.drawRectangle({ x: M, y: y - h, width: 3, height: h, color: C.accent });
    lines.forEach((l, i) => text(l, M + 10, y - 13 - i * 12, 9, semi, C.ink));
    y -= h + 16;
  }

  section("Resumen por proyecto");
  table(
    [
      { label: "Proyecto", width: 150, wrap: true },
      { label: "Horas", width: 55, align: "right" },
      { label: "Valor hora", width: 75, align: "right" },
      { label: "Moneda", width: 45 },
      { label: "Importe", width: 85, align: "right" },
      { label: "Observación", width: CW - 410, wrap: true },
    ],
    d.proyectos.map((p) => [p.codigo, formatHours(p.horas), valor(p.valorHora), p.moneda ?? "", money(p.importe), p.aviso ?? ""]),
  );

  section(`Totales por moneda (${d.alicuotaLabel})`);
  table(
    [
      { label: "Moneda", width: 80 },
      { label: "Subtotal", width: 140, align: "right" },
      { label: d.alicuotaLabel, width: 140, align: "right" },
      { label: "Total", width: CW - 360, align: "right" },
    ],
    d.totales.map((t) => [t.moneda, money(t.subtotal), money(t.iva), money(t.total)]),
    { boldRows: new Set(d.totales.map((_, i) => i)) },
  );

  section("Detalle de horas");
  table(
    [
      { label: "Fecha", width: 56 },
      { label: "Colaborador", width: 78, wrap: true },
      { label: "Proyecto", width: 70, wrap: true },
      { label: "Tarea", width: 136, wrap: true },
      { label: "Horas", width: 34, align: "right" },
      { label: "Valor hora", width: 52, align: "right" },
      { label: "Moneda", width: 34 },
      { label: "Importe", width: CW - 460, align: "right" },
    ],
    d.detalle.map((r) => [isoToDisplayDate(r.fecha), r.colaborador, r.proyecto, r.tarea, formatHours(r.horas), valor(r.valorHora), r.moneda ?? "", money(r.importe)]),
  );

  // Pie: fecha de generación y «Página X de Y» en cada página
  const pages = doc.getPages();
  const stamp = `Generado el ${formatDateTime(generado.toISOString())}`;
  pages.forEach((pg, i) => {
    page = pg;
    page.drawRectangle({ x: M, y: M + 12, width: CW, height: 0.5, color: C.accent });
    text(stamp, M, M, 7.5, reg, C.muted);
    right(`Página ${i + 1} de ${pages.length}`, A4.w - M, M, 7.5, reg, C.muted);
  });

  return doc.save();
}
