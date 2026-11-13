/**
 * Columnas de los .xlsx de ARCA («Mis Comprobantes Emitidos» → Ventas, «Recibidos» →
 * Compras). Client-safe. La clave de cada columna es la misma que la del campo en
 * lib/airtable/schema.ts (TABLES.ventas / TABLES.compras), así el mapeo a IDs es directo.
 */

export type Kind = "ventas" | "compras";

export const KINDS: readonly Kind[] = ["ventas", "compras"];

export function isKind(value: unknown): value is Kind {
  return value === "ventas" || value === "compras";
}

export type ColumnType = "fecha" | "texto" | "entero" | "numero";

export interface Column {
  key: string;
  /** Encabezado de referencia, tal cual ARCA. */
  header: string;
  type: ColumnType;
}

const c = (key: string, header: string, type: ColumnType): Column => ({ key, header, type });

const HEAD: Column[] = [
  c("fecha", "Fecha", "fecha"),
  c("tipo", "Tipo", "texto"),
  c("puntoVenta", "Punto de Venta", "entero"),
  c("numeroDesde", "Número Desde", "entero"),
  c("numeroHasta", "Número Hasta", "entero"),
  c("codAutorizacion", "Cód. Autorización", "texto"),
];

/** Importes: los 17 numéricos (moneda del comprobante). */
export const IMPORTES: Column[] = [
  c("netoGravIva0", "Neto Grav. IVA 0%", "numero"),
  c("iva25", "IVA 2,5%", "numero"),
  c("netoGravIva25", "Neto Grav. IVA 2,5%", "numero"),
  c("iva5", "IVA 5%", "numero"),
  c("netoGravIva5", "Neto Grav. IVA 5%", "numero"),
  c("iva105", "IVA 10,5%", "numero"),
  c("netoGravIva105", "Neto Grav. IVA 10,5%", "numero"),
  c("iva21", "IVA 21%", "numero"),
  c("netoGravIva21", "Neto Grav. IVA 21%", "numero"),
  c("iva27", "IVA 27%", "numero"),
  c("netoGravIva27", "Neto Grav. IVA 27%", "numero"),
  c("netoGravadoTotal", "Neto Gravado Total", "numero"),
  c("netoNoGravado", "Neto No Gravado", "numero"),
  c("opExentas", "Op. Exentas", "numero"),
  c("otrosTributos", "Otros Tributos", "numero"),
  c("totalIva", "Total IVA", "numero"),
  c("impTotal", "Imp. Total", "numero"),
];

const MONEDA: Column[] = [c("tipoCambio", "Tipo Cambio", "numero"), c("moneda", "Moneda", "texto")];

/** Ventas: 28 columnas. */
export const VENTAS_COLUMNS: readonly Column[] = [
  ...HEAD,
  c("tipoDocReceptor", "Tipo Doc. Receptor", "texto"),
  c("nroDocReceptor", "Nro. Doc. Receptor", "texto"),
  c("denominacionReceptor", "Denominación Receptor", "texto"),
  ...MONEDA,
  ...IMPORTES,
];

/** Compras: 30 columnas. */
export const COMPRAS_COLUMNS: readonly Column[] = [
  ...HEAD,
  c("tipoDocEmisor", "Tipo Doc. Emisor", "texto"),
  c("nroDocEmisor", "Nro. Doc. Emisor", "texto"),
  c("denominacionEmisor", "Denominación Emisor", "texto"),
  c("tipoDocReceptor", "Tipo Doc. Receptor", "texto"),
  c("nroDocReceptor", "Nro. Doc. Receptor", "texto"),
  ...MONEDA,
  ...IMPORTES,
];

export const COLUMNS: Record<Kind, readonly Column[]> = { ventas: VENTAS_COLUMNS, compras: COMPRAS_COLUMNS };

/** Columna del documento de la contraparte (para la Clave ARCA, el Cliente o el Proveedor). */
export const DOC_KEY: Record<Kind, { nro: string; denominacion: string }> = {
  ventas: { nro: "nroDocReceptor", denominacion: "denominacionReceptor" },
  compras: { nro: "nroDocEmisor", denominacion: "denominacionEmisor" },
};

/**
 * Normalización de encabezados: sin tildes, minúsculas, cualquier espacio o salto
 * de línea → un espacio, sin espacios en los bordes. La puntuación se respeta.
 */
export function normalizeHeader(text: unknown): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const KIND_LABEL: Record<Kind, { titulo: string; archivo: string; otro: Kind }> = {
  ventas: { titulo: "Ventas", archivo: "Mis Comprobantes Emitidos", otro: "compras" },
  compras: { titulo: "Compras", archivo: "Mis Comprobantes Recibidos", otro: "ventas" },
};
