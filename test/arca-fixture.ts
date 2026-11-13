/**
 * Archivos ARCA sintéticos (Ventas = «Mis Comprobantes Emitidos», Compras =
 * «Recibidos»). CUITs inventados con dígito verificador válido; nada real.
 */
import { cuitCheckDigit } from "@/lib/cuit";
import { COLUMNS, type Kind } from "@/lib/ventas-compras/columns";
import { buildXlsx, type FixtureCell } from "./xlsx-fixture";

/** CUIT sintético válido: prefijo (2) + 8 dígitos + verificador. Salta los que no tienen verificador. */
export function cuitSintetico(prefijo: string, cuerpo: number): string {
  for (let n = cuerpo; ; n++) {
    const first10 = `${prefijo}${String(n).padStart(8, "0")}`;
    const check = cuitCheckDigit(first10);
    if (check !== null) return `${first10}${check}`;
  }
}

export type FilaArca = Partial<Record<string, FixtureCell>>;

export interface ArcaFileOptions {
  /** Fila de título arriba de los encabezados (como exporta ARCA). Por defecto: sí. */
  titulo?: string | null;
  /** Encabezados alterados (mayúsculas, sin tildes, saltos de línea, espacios). */
  encabezadosRaros?: boolean;
  /** Columnas a omitir (por clave). */
  sinColumnas?: string[];
  sharedStrings?: boolean;
}

function rareHeader(h: string, i: number): string {
  const noAccents = h.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const variants = [h.toUpperCase(), `  ${noAccents}  `, h.replace(" ", "\n"), h.toLowerCase().replace(/ /g, "   ")];
  return variants[i % variants.length];
}

export function arcaXlsx(kind: Kind, filas: FilaArca[], opts: ArcaFileOptions = {}): Buffer {
  const cols = COLUMNS[kind].filter((c) => !opts.sinColumnas?.includes(c.key));
  const header = cols.map((c, i) => (opts.encabezadosRaros ? rareHeader(c.header, i) : c.header));
  const titulo = opts.titulo === undefined ? `Mis Comprobantes ${kind === "ventas" ? "Emitidos" : "Recibidos"} - CUIT 20000000001` : opts.titulo;
  const rows: (FixtureCell[] | null)[] = [];
  if (titulo !== null) rows.push([titulo], null);
  rows.push(header);
  for (const f of filas) rows.push(cols.map((c) => f[c.key] ?? null));
  return buildXlsx(rows, { sharedStrings: opts.sharedStrings });
}

/** Fila mínima de Factura C en pesos. */
export function factura(over: FilaArca = {}): FilaArca {
  return {
    fecha: "15/10/2026",
    tipo: "11 - Factura C",
    puntoVenta: 2,
    numeroDesde: 1,
    numeroHasta: 1,
    codAutorizacion: "76123456789012",
    tipoDocReceptor: "CUIT",
    nroDocReceptor: "30000000007",
    denominacionReceptor: "QA Cliente",
    tipoDocEmisor: "CUIT",
    nroDocEmisor: "30000000007",
    denominacionEmisor: "QA Proveedor",
    moneda: "$",
    impTotal: 1000,
    totalIva: 0,
    ...over,
  };
}
