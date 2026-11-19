import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { and, field, formula, or } from "@/lib/airtable/formula";
import { TABLES } from "@/lib/airtable/schema";
import { parseDatos } from "../factura";

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

/** ¿Hay un comprobante Producción + Autorizada con esta Clave ARCA? Lanza si no se puede leer. */
export async function ventaDeFacturaEmitida(clave: string): Promise<boolean> {
  const target = clave.trim();
  if (!target) return false;
  const rows = await getAirtableClient().list(CE.id, {
    fields: [F.ambiente, F.estado, F.claveArca],
    filterByFormula: and(formula`${field(F.ambiente)} = ${"Producción"}`, formula`${field(F.estado)} = ${"Autorizada"}`, formula`${field(F.claveArca)} = ${target}`),
  });
  // Se vuelve a filtrar en código (la fórmula solo achica la lectura).
  return rows.some((r) => r.fields[F.ambiente] === "Producción" && r.fields[F.estado] === "Autorizada" && typeof r.fields[F.claveArca] === "string" && (r.fields[F.claveArca] as string).trim() === target);
}

const ESTADOS_QUE_RESERVAN = ["En proceso", "Incierta", "Autorizada"] as const;

/**
 * ¿La hora está en el snapshot de un comprobante Producción En proceso, Incierta o Autorizada?
 * La fórmula achica a esos comprobantes y a los que mencionan el ID en Datos; después se parsea el
 * JSON y se confirma que el ID está en `horas` (nunca solo por substring). Lanza si no se puede leer.
 */
export async function horaEnFacturaEmitida(horaId: string): Promise<boolean> {
  const rows = await getAirtableClient().list(CE.id, {
    fields: [F.ambiente, F.estado, F.datos],
    filterByFormula: and(
      formula`${field(F.ambiente)} = ${"Producción"}`,
      or(...ESTADOS_QUE_RESERVAN.map((e) => formula`${field(F.estado)} = ${e}`)),
      formula`FIND(${horaId}, ${field(F.datos)} & "")`,
    ),
  });
  return rows.some((r) => {
    if (r.fields[F.ambiente] !== "Producción" || !(ESTADOS_QUE_RESERVAN as readonly unknown[]).includes(r.fields[F.estado])) return false;
    const d = parseDatos(r.fields[F.datos]);
    return d !== null && d.horas.includes(horaId);
  });
}
