/**
 * Del resultado de las reglas existentes al dato del reporte. Puro y client-safe.
 * - Comprobantes: FilaListado de `evaluarComprobante` (lib/ventas-compras/listado.ts).
 * - Tesorería: Evaluacion de `evaluarMovimiento` (lib/tesoreria/rules.ts).
 */
import type { Evaluacion, MovimientoDatos } from "@/lib/tesoreria/rules";
import type { Kind } from "@/lib/ventas-compras/columns";
import type { FilaListado } from "@/lib/ventas-compras/listado";
import type { ComprobanteR, MovimientoR } from "./types";

/** Ventas: Impacto = Neto $. Compras: el de `evaluar` (−Neto $, o 0 si se imputó a un socio). */
export function aComprobanteR(kind: Kind, f: FilaListado): ComprobanteR {
  return {
    kind,
    mes: f.mesDevengado?.slice(0, 7) ?? null,
    categoria: f.categoria?.id ?? null,
    unidadNegocio: f.unidadNegocio?.id ?? null,
    proyecto: f.proyecto?.id ?? null,
    cliente: kind === "ventas" ? (f.contraparte?.id ?? null) : null,
    proveedor: kind === "compras" ? (f.contraparte?.id ?? null) : null,
    socio: f.socio?.id ?? null,
    total: f.importes.total,
    neto: f.importes.neto,
    impacto: kind === "ventas" ? f.importes.neto : f.importes.impacto,
    cuentaSocio: f.importes.cuentaSocio,
  };
}

export function aMovimientoR(m: MovimientoDatos, ev: Evaluacion): MovimientoR {
  return {
    fecha: m.fecha,
    cuenta: m.cuenta,
    tipo: m.tipoOperacion,
    cliente: m.cliente,
    proveedor: m.proveedor,
    socio: m.socio,
    categoria: ev.categoria,
    suma: ev.suma,
    importeSigno: ev.importeSigno,
    importePesos: ev.importePesos ?? 0,
    impacto: ev.impacto,
    cuentaSocio: ev.cuentaSocio,
  };
}
