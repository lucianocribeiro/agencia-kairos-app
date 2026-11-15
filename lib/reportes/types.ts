/**
 * Datos de entrada de los reportes, ya evaluados con las reglas existentes
 * (lib/ventas-compras/listado.ts `evaluarComprobante`, lib/tesoreria/rules.ts
 * `evaluarMovimiento`, lib/horas/time.ts `recordHours`). Importes en centavos enteros.
 * Client-safe y puro: el servidor arma estos objetos y las funciones de lib/reportes
 * solo suman.
 */

export interface RefR {
  id: string;
  nombre: string;
}

/** Un comprobante de Ventas o Compras con sus valores efectivos. */
export interface ComprobanteR {
  kind: "ventas" | "compras";
  /** Mes devengado efectivo "AAAA-MM" (vacío → mes de la Fecha). */
  mes: string | null;
  /** Categoría efectiva (Ventas: la elegida o la del Parámetro; Compras: la elegida o la del proveedor). */
  categoria: string | null;
  /** UN efectiva (la elegida o la del proyecto). */
  unidadNegocio: string | null;
  proyecto: string | null;
  /** Ventas: cliente efectivo (proyecto → CUIT único → ninguno). */
  cliente: string | null;
  /** Compras: link Proveedor. */
  proveedor: string | null;
  /** Compras: imputado a socio. */
  socio: string | null;
  /** Centavos con signo. */
  total: number;
  neto: number;
  /** Ventas: Neto $. Compras: −Neto $, o 0 si se imputó a un socio. */
  impacto: number;
  /** Compras: Neto $ si se imputó a un socio; si no, 0. */
  cuentaSocio: number;
}

/** Un movimiento de Tesorería con sus valores efectivos. */
export interface MovimientoR {
  fecha: string | null;
  cuenta: string | null;
  tipo: string | null;
  cliente: string | null;
  proveedor: string | null;
  socio: string | null;
  /** Efectiva (solo si suma = S). */
  categoria: string | null;
  suma: "S" | "N";
  /** Centavos en la moneda de la cuenta (+ cobranza, − pago). */
  importeSigno: number;
  /** Centavos en pesos (0 si es USD sin TC). */
  importePesos: number;
  /** Importe $ si suma = S; si no, 0. */
  impacto: number;
  /** −Importe $ si el tipo es de socio; si no, 0. */
  cuentaSocio: number;
}

export interface HoraR {
  fecha: string | null;
  proyecto: string | null;
  /** recordHours del registro. */
  horas: number;
}

/** Margen = resultado / ingresos; null si ingresos = 0. */
export const margen = (resultado: number, ingresos: number): number | null => (ingresos === 0 ? null : resultado / ingresos);

export const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
