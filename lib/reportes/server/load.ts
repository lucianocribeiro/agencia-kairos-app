import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { TABLES } from "@/lib/airtable/schema";
import { addDays } from "@/lib/horas/dates";
import { fechaRangeFormula } from "@/lib/horas/server/repo";
import { recordHours } from "@/lib/horas/time";
import { evaluarMovimiento, type TesoreriaCtx } from "@/lib/tesoreria/rules";
import { loadTesoreriaCtx, toMovimiento } from "@/lib/tesoreria/server/movimientos";
import type { Kind } from "@/lib/ventas-compras/columns";
import { evaluarComprobante } from "@/lib/ventas-compras/listado";
import { toGuardado } from "@/lib/ventas-compras/server/comprobantes";
import { loadImportContext, type ImportContext } from "@/lib/ventas-compras/server/context";
import { PARAM_PRIMER_MES, sumarMeses, type Periodo } from "../periodo";
import { aComprobanteR, aMovimientoR } from "../normalizar";
import type { ComprobanteR, HoraR, MovimientoR } from "../types";

/**
 * Lecturas de los reportes. Cada registro se evalúa con las reglas que ya usan las
 * listas (evaluarComprobante, evaluarMovimiento, recordHours); acá solo se lee y se
 * normaliza. Se piden solo los campos que usan los reportes.
 */

const V = TABLES.ventas.fields;
const C = TABLES.compras.fields;
const M = TABLES.tesoreria.fields;
const H = TABLES.horas.fields;

/** Campos de Ventas / Compras que necesitan los importes y los valores efectivos. */
export const COMPROBANTE_FIELDS: Record<Kind, string[]> = {
  ventas: [V.tipoComprobante, V.fecha, V.impTotal, V.totalIva, V.otrosTributos, V.tipoCambio, V.nroDocReceptor, V.mesDevengado, V.proyecto, V.unidadNegocio, V.categoria],
  compras: [C.tipoComprobante, C.fecha, C.impTotal, C.totalIva, C.otrosTributos, C.tipoCambio, C.mesDevengado, C.proyecto, C.unidadNegocio, C.categoria, C.socio, C.proveedor],
};

export const MOVIMIENTO_FIELDS = [M.fecha, M.cuenta, M.movimiento, M.importe, M.tipoOperacion, M.cliente, M.proveedor, M.sumaResultados, M.categoria, M.socio, M.tipoCambio];

export const HORA_FIELDS = [H.fecha, H.proyecto, H.horaDesde, H.horaHasta];

export async function cargarComprobantes(kind: Kind): Promise<{ items: ComprobanteR[]; contexto: ImportContext }> {
  const [contexto, records] = await Promise.all([
    loadImportContext(kind, { claves: false }),
    getAirtableClient().list(TABLES[kind].id, { fields: COMPROBANTE_FIELDS[kind] }),
  ]);
  const refs = { tipos: contexto.byId.tipos, clientesPorCuit: contexto.refs.clientesPorCuit, proveedores: contexto.byId.proveedores };
  return { items: records.map((r) => aComprobanteR(kind, evaluarComprobante(kind, toGuardado(kind, r), refs, contexto.ctx))), contexto };
}

export async function cargarMovimientos(): Promise<{ items: MovimientoR[]; ctx: TesoreriaCtx }> {
  const [ctx, records] = await Promise.all([loadTesoreriaCtx(), getAirtableClient().list(TABLES.tesoreria.id, { fields: MOVIMIENTO_FIELDS })]);
  const items = records.map((r) => {
    const m = toMovimiento(r);
    return aMovimientoR(m, evaluarMovimiento(m, ctx));
  });
  return { items, ctx };
}

/** Horas con Fecha en el período (filtro en Airtable y otra vez en código). */
export async function cargarHoras(periodo: Periodo): Promise<HoraR[]> {
  const range = { desde: `${periodo.desde}-01`, hasta: addDays(`${sumarMeses(periodo.hasta, 1)}-01`, -1) };
  const records = await getAirtableClient().list(TABLES.horas.id, { fields: HORA_FIELDS, filterByFormula: fechaRangeFormula(range) });
  const first = (v: unknown) => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);
  return records
    .map((r) => ({
      fecha: typeof r.fields[H.fecha] === "string" ? (r.fields[H.fecha] as string) : null,
      proyecto: first(r.fields[H.proyecto]),
      horas: recordHours(r.fields[H.horaDesde] as number | undefined, r.fields[H.horaHasta] as number | undefined),
    }))
    .filter((h) => h.fecha !== null && h.fecha >= range.desde && h.fecha <= range.hasta);
}

/** Valor del parámetro «Primer mes de los reportes» (texto), o null. */
export async function cargarPrimerMes(): Promise<unknown> {
  const P = TABLES.parametros.fields;
  const rows = await getAirtableClient().list(TABLES.parametros.id, { fields: [P.concepto, P.valor] });
  const row = rows.find((r) => String(r.fields[P.concepto] ?? "").trim() === PARAM_PRIMER_MES);
  return row ? (row.fields[P.valor] ?? null) : null;
}
