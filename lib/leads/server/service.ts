import "server-only";

import { getAirtableClient, type Fields } from "@/lib/airtable/client";
import { invalidFieldIds } from "@/lib/airtable/payload";
import { TABLES } from "@/lib/airtable/schema";
import type { FieldErrors, RawValues, Values } from "@/lib/abm/fields";
import { CLIENTE_ACTIVO } from "@/lib/abm/cliente-estado";
import type { ServiceResult } from "@/lib/abm/types";
import { Compensation, previousOf, WRITE_MESSAGES } from "@/lib/abm/server/compensation";
import { createMaestro } from "@/lib/abm/server/maestros-service";
import { esConvertido, LEAD_FIELDS, LEAD_MESSAGES, LEAD_TIPO_CLIENTE, validateLead, type LeadDTO } from "@/lib/leads/leads";

/**
 * Leads (CC-F4-06): lista, alta, edición, borrado y «Pasar a cliente». Solo Admin (rutas con
 * adminRoute). Un lead convertido (Tipo = Cliente o con link a un cliente) es de solo lectura:
 * la edición y una segunda conversión → 409; solo se puede eliminar. Borrar un lead nunca toca
 * al cliente.
 */

const L = TABLES.leads.fields;
const C = TABLES.clientes.fields;
const LEADS = TABLES.leads.id;
const CLIENTES = TABLES.clientes.id;
const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;

/** clave del formulario → ID de campo (los 14 campos que edita el formulario). */
const FIELD_IDS: Record<string, string> = Object.fromEntries(LEAD_FIELDS.map((f) => [f.key, L[f.key as keyof typeof L]]));
const READ_FIELDS = [...Object.values(FIELD_IDS), L.cliente];

/**
 * Lead → Clientes: campo del lead → clave del spec de Clientes (lib/abm/maestros.ts). Los demás
 * (Tipo, Status, Proyecto, Origen, Referido por, Ventas, Cobranzas, Ventas SRL, Cobranzas SRL) no
 * tienen campo en Clientes y no se copian.
 */
export const CONVERSION_MAP = {
  nombre: "nombre",
  contacto: "contacto",
  telefono: "telefono",
  mail: "mail",
  comentarios: "observaciones",
} as const;

const fail = (status: 400 | 404 | 409 | 500 | 503, error: string, fieldErrors?: FieldErrors): ServiceResult<never> => ({
  ok: false,
  status,
  error,
  ...(fieldErrors ? { fieldErrors } : {}),
});

const text = (v: unknown) => (typeof v === "string" ? v : "");
const links = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function toValues(fields: Fields): Values {
  return Object.fromEntries(LEAD_FIELDS.map((f) => [f.key, typeof fields[FIELD_IDS[f.key]] === "string" ? (fields[FIELD_IDS[f.key]] as string) : null]));
}

const convertido = (fields: Fields) => esConvertido(fields[L.tipo], links(fields[L.cliente]));

async function readLead(id: string) {
  return getAirtableClient().get(LEADS, id, { fields: READ_FIELDS });
}

/** Valores parseados → campos por ID. Alta: se omiten los vacíos; edición: vacío = borrar. Nunca el link Cliente. */
function toFields(values: Values, mode: "create" | "edit"): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === null) {
      if (mode === "edit") out[FIELD_IDS[key]] = null;
    } else out[FIELD_IDS[key]] = value;
  }
  return out;
}

function writable(fields: Fields): boolean {
  const bad = invalidFieldIds(LEADS, fields);
  if (bad.length === 0) return true;
  console.error("[leads] Payload inválido (bug del servidor)", { fields: bad });
  return false;
}

export async function listLeads(): Promise<LeadDTO[]> {
  const client = getAirtableClient();
  const [records, clientes] = await Promise.all([client.list(LEADS, { fields: READ_FIELDS }), client.list(CLIENTES, { fields: [C.nombre] })]);
  const nombres = new Map(clientes.map((c) => [c.id, text(c.fields[C.nombre]) || "(sin nombre)"]));
  return records.map((r) => {
    const linked = links(r.fields[L.cliente]).find((id) => nombres.has(id));
    return {
      id: r.id,
      values: toValues(r.fields),
      cliente: linked ? { id: linked, nombre: nombres.get(linked)! } : null,
      convertido: convertido(r.fields),
    };
  });
}

export async function createLead(raw: RawValues): Promise<ServiceResult<{ id: string }>> {
  const { values, errors } = validateLead(raw);
  if (Object.keys(errors).length > 0) return fail(400, LEAD_MESSAGES.validacion, errors);
  const fields = toFields(values, "create");
  if (!writable(fields)) return fail(500, WRITE_MESSAGES.revertido);
  const [created] = await getAirtableClient().create(LEADS, [fields], { returnFields: [] });
  return { ok: true, data: { id: created.id } };
}

/**
 * Edición: solo de un lead no convertido (409). Como no hay transacciones, después de escribir se
 * relee: si en el medio el lead pasó a cliente, se restauran los valores anteriores dejando Tipo =
 * Cliente (el link lo escribió la conversión) → 409; si la relectura falla → se restaura → 503.
 */
export async function updateLead(id: string, raw: RawValues): Promise<ServiceResult<{ id: string }>> {
  if (!RECORD_ID.test(id)) return fail(404, LEAD_MESSAGES.noEncontrado);
  const record = await readLead(id);
  if (!record) return fail(404, LEAD_MESSAGES.noEncontrado);
  if (convertido(record.fields)) return fail(409, LEAD_MESSAGES.convertido);

  const { values, errors } = validateLead(raw);
  if (Object.keys(errors).length > 0) return fail(400, LEAD_MESSAGES.validacion, errors);
  const fields = toFields(values, "edit");
  const previous = previousOf(fields, record.fields);
  if (!writable(fields) || !writable(previous)) return fail(500, WRITE_MESSAGES.revertido);

  await getAirtableClient().update(LEADS, [{ id, fields }], { returnFields: [] });

  const after = await readLead(id).catch(() => "error" as const);
  if (after === null) return fail(404, LEAD_MESSAGES.noEncontrado); // lo eliminaron en el medio: no hay nada que restaurar
  if (after !== "error" && !convertido(after.fields)) return { ok: true, data: { id } };

  const ahoraConvertido = after !== "error";
  const restore = ahoraConvertido ? { ...previous, [L.tipo]: LEAD_TIPO_CLIENTE } : previous;
  try {
    await getAirtableClient().update(LEADS, [{ id, fields: restore }], { returnFields: [] });
  } catch {
    console.error("[leads] Edición: CAMBIO INCOMPLETO, falló la restauración", { ids: [id] });
    return fail(500, WRITE_MESSAGES.incompleto);
  }
  console.error("[leads] Verificación posterior fallida", { id, check: "convertido", motivo: ahoraConvertido ? "conflicto" : "lectura" });
  return ahoraConvertido ? fail(409, LEAD_MESSAGES.convertido) : fail(503, WRITE_MESSAGES.noVerificado);
}

/** Borrado físico del lead (también de uno convertido). Nunca toca al cliente vinculado. */
export async function deleteLead(id: string): Promise<ServiceResult<{ id: string }>> {
  if (!RECORD_ID.test(id)) return fail(404, LEAD_MESSAGES.noEncontrado);
  const record = await getAirtableClient().get(LEADS, id, { fields: [L.nombre] });
  if (!record) return fail(404, LEAD_MESSAGES.noEncontrado);
  await getAirtableClient().delete(LEADS, [id]);
  return { ok: true, data: { id } };
}

/** Clientes → campos del diálogo: Nombre y Sigla tienen su lugar; el resto va al mensaje general. */
function dialogErrors(fieldErrors: FieldErrors | undefined): FieldErrors | undefined {
  if (!fieldErrors) return undefined;
  const out: FieldErrors = {};
  for (const [key, message] of Object.entries(fieldErrors)) out[key === "nombre" || key === "sigla" ? key : "general"] = message;
  return out;
}

/**
 * «Pasar a cliente». Orden:
 * 1. Se relee el lead: no existe → 404; ya convertido → 409.
 * 2. Se crea el cliente con el ABM de Clientes (`createMaestro`): las mismas reglas, unicidad y
 *    verificaciones posteriores (Nombre y Sigla únicos, Sigla de 2 letras, Estado = Activo). Si
 *    falla, no se escribió nada y el error vuelve a los campos del diálogo.
 * 3. Se actualiza el lead: Tipo = Cliente, Cliente = el cliente nuevo. Si falla → se borra el
 *    cliente creado (503; si el borrado falla, 500 y log de IDs).
 * 4. Verificación posterior (fail-closed): el lead tiene que tener Tipo = Cliente y estar
 *    vinculado exactamente al cliente de este request.
 *    - Vinculado a otro cliente (otra conversión ganó) → se borra solo nuestro cliente; el lead
 *      no se toca → 409.
 *    - Vinculado al nuestro pero con otro Tipo (alguien editó en el medio), o la relectura falla →
 *      se restaura el lead y se borra el cliente → 409 / 503 (500 si algo del deshacer falla).
 */
export async function convertLead(id: string, raw: RawValues): Promise<ServiceResult<{ id: string; clienteId: string }>> {
  if (!RECORD_ID.test(id)) return fail(404, LEAD_MESSAGES.noEncontrado);
  const record = await readLead(id);
  if (!record) return fail(404, LEAD_MESSAGES.noEncontrado);
  if (convertido(record.fields)) return fail(409, LEAD_MESSAGES.convertido);

  const sigla = typeof raw.sigla === "string" ? raw.sigla.trim() : "";
  if (!sigla) return fail(400, LEAD_MESSAGES.validacion, { sigla: LEAD_MESSAGES.siglaRequerida });

  const values = toValues(record.fields);
  const clienteRaw: RawValues = { estado: CLIENTE_ACTIVO, sigla };
  for (const [from, to] of Object.entries(CONVERSION_MAP)) clienteRaw[to] = values[from] === null ? "" : String(values[from]);

  const created = await createMaestro("clientes", clienteRaw);
  if (!created.ok) return { ...created, ...(created.fieldErrors ? { fieldErrors: dialogErrors(created.fieldErrors) } : {}) };
  const clienteId = created.data.id;

  const fields: Fields = { [L.tipo]: LEAD_TIPO_CLIENTE, [L.cliente]: [clienteId] };
  const previous = previousOf(fields, record.fields);
  const tx = new Compensation();
  tx.created(CLIENTES, clienteId);
  const ids = { lead: id, cliente: clienteId };

  try {
    if (!writable(fields) || !writable(previous)) throw new Error("payload");
    await tx.update(LEADS, [{ id, fields, previous }]);
  } catch {
    const ok = await tx.rollback();
    console.error(ok ? "[leads] Conversión revertida" : "[leads] Conversión: CAMBIO INCOMPLETO, falló el rollback", ids);
    return ok ? fail(503, WRITE_MESSAGES.revertido) : fail(500, WRITE_MESSAGES.incompleto);
  }

  const after = await readLead(id).catch(() => "error" as const);
  if (after !== "error") {
    const linked = after ? links(after.fields[L.cliente]) : [];
    if (after && linked.length === 1 && linked[0] === clienteId && after.fields[L.tipo] === LEAD_TIPO_CLIENTE) {
      return { ok: true, data: { id, clienteId } };
    }
    if (!linked.includes(clienteId)) {
      // Otra conversión ganó, o eliminaron el lead en el medio: solo se borra nuestro cliente; el lead no se toca.
      try {
        await getAirtableClient().delete(CLIENTES, [clienteId]);
      } catch {
        console.error("[leads] Conversión: CAMBIO INCOMPLETO, no se pudo borrar el cliente", ids);
        return fail(500, WRITE_MESSAGES.incompleto);
      }
      console.error("[leads] Verificación posterior fallida", { ...ids, check: "conversion", motivo: after ? "conflicto" : "eliminado" });
      return after ? fail(409, LEAD_MESSAGES.carrera) : fail(404, LEAD_MESSAGES.noEncontrado);
    }
  }
  // Vinculado al nuestro con otro Tipo, o la relectura falló: se restaura el lead y se borra el cliente.
  const ok = await tx.rollback();
  const lectura = after === "error";
  console.error("[leads] Verificación posterior fallida", { ...ids, check: "conversion", motivo: lectura ? "lectura" : "conflicto", rollback: ok ? "ok" : "fallido" });
  if (!ok) return fail(500, WRITE_MESSAGES.incompleto);
  return lectura ? fail(503, WRITE_MESSAGES.noVerificado) : fail(409, LEAD_MESSAGES.carrera);
}
