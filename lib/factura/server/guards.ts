import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { and, field, formula, or, type Formula } from "@/lib/airtable/formula";
import { TABLES } from "@/lib/airtable/schema";
import { claveArca } from "@/lib/ventas-compras/rules";
import { autorizacionDelSnapshot, CBTE_TIPO_FACTURA_A, parseDatos } from "../factura";

/**
 * Guardas de borrado de la factura electrónica (CC-F5-12). Los links inversos de «Comprobantes
 * emitidos» se escriben al final del registro en Producción; si ese update falla, la Venta y las
 * horas ya existen pero todavía no tienen el link. Estas guardas miran los datos del comprobante:
 * - una Venta con la misma Clave ARCA que un comprobante Producción + Autorizada no se borra;
 * - una hora que está en el snapshot (Datos) de un comprobante Producción En proceso, Incierta o
 *   Autorizada no se borra.
 * Fail-closed: si no se puede leer «Comprobantes emitidos», lanzan y quien llama responde 503.
 */

const CE = TABLES.comprobantesEmitidos;
const F = CE.fields;

export const GUARD_MESSAGES = {
  noVerificado: "No pudimos verificar los comprobantes emitidos. Probá de nuevo en unos minutos.",
} as const;

/** Filtro de la guarda de Ventas: todos los comprobantes Producción + Autorizada (se esperan pocos). */
export function filtroVentaFacturada(): Formula {
  return and(formula`${field(F.ambiente)} = ${"Producción"}`, formula`${field(F.estado)} = ${"Autorizada"}`);
}

/**
 * Clave ARCA de un comprobante: la guardada en «Clave ARCA» o, si está vacía, la derivada del
 * snapshot válido (claveArca(1, PV, Número, CUIT receptor), la misma derivación que al autorizar).
 */
export function claveDeComprobante(fields: Record<string, unknown>): string | null {
  const guardada = typeof fields[F.claveArca] === "string" ? (fields[F.claveArca] as string).trim() : "";
  if (guardada) return guardada;
  const snap = autorizacionDelSnapshot(parseDatos(fields[F.datos]));
  return snap ? claveArca(CBTE_TIPO_FACTURA_A, snap.puntoVenta, snap.numero, snap.receptor.cuit) : null;
}

/**
 * ¿Hay un comprobante Producción + Autorizada con la Clave ARCA de esta Venta? SIEMPRE lee la tabla
 * (CC-F5-13 · F-11, fail-closed: lanza si no se puede leer), aunque la clave de la Venta esté vacía;
 * una clave vacía nunca coincide. Se compara en código.
 */
export async function ventaDeFacturaEmitida(clave: string): Promise<boolean> {
  const target = clave.trim();
  const rows = await getAirtableClient().list(CE.id, { fields: [F.ambiente, F.estado, F.claveArca, F.datos], filterByFormula: filtroVentaFacturada() });
  if (!target) return false;
  return rows.some((r) => r.fields[F.ambiente] === "Producción" && r.fields[F.estado] === "Autorizada" && claveDeComprobante(r.fields) === target);
}

const ESTADOS_QUE_RESERVAN = ["En proceso", "Incierta", "Autorizada"] as const;

/**
 * ¿La hora está en el snapshot de un comprobante Producción En proceso, Incierta o Autorizada?
 * La fórmula achica a esos comprobantes y a los que mencionan el ID en Datos; después se parsea el
 * JSON y se confirma que el ID está en `horas` (nunca solo por substring). Lanza si no se puede leer.
 */
/** Filtro de la guarda de Horas: Producción + En proceso/Incierta/Autorizada + el ID en Datos. */
export function filtroHoraEnFactura(horaId: string): Formula {
  return and(
    formula`${field(F.ambiente)} = ${"Producción"}`,
    or(...ESTADOS_QUE_RESERVAN.map((e) => formula`${field(F.estado)} = ${e}`)),
    formula`FIND(${horaId}, ${field(F.datos)} & "")`,
  );
}

export async function horaEnFacturaEmitida(horaId: string): Promise<boolean> {
  const rows = await getAirtableClient().list(CE.id, { fields: [F.ambiente, F.estado, F.datos], filterByFormula: filtroHoraEnFactura(horaId) });
  return rows.some((r) => {
    if (r.fields[F.ambiente] !== "Producción" || !(ESTADOS_QUE_RESERVAN as readonly unknown[]).includes(r.fields[F.estado])) return false;
    const d = parseDatos(r.fields[F.datos]);
    return d !== null && d.horas.includes(horaId);
  });
}
