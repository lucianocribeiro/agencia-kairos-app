import "server-only";

import { getAirtableClient, type Fields } from "@/lib/airtable/client";
import { findDuplicates, findReferences, losesUniqueRace, REFERENCED_MESSAGE } from "@/lib/airtable/integrity";
import { invalidFieldIds, isRecordId } from "@/lib/airtable/payload";
import { TABLES } from "@/lib/airtable/schema";
import type { FieldErrors, FieldSpec, RawValues, Values } from "@/lib/abm/fields";
import { FIELD_MESSAGES } from "@/lib/abm/fields";
import { isMaestroSlug, validateMaestro, type MaestroSlug } from "@/lib/abm/maestros";
import type { AbmData, LinkOption, RecordDTO, ServiceResult } from "@/lib/abm/types";
import { Compensation, previousOf, rollbackAndLog, runPostWriteChecks, WRITE_MESSAGES, type PostWriteCheck } from "./compensation";
import { injectFault } from "./fault-injection";
import { MAESTRO_CONFIGS, type MaestroConfig, type WritePlan } from "./maestros-config";

/**
 * ABM genérico de Maestros. Cada operación lee la config de la tabla y aplica,
 * en este orden: parseo y reglas del spec (las mismas que el formulario) →
 * links permitidos → unicidad → reglas de servidor (beforeWrite) → validación
 * de payloads → escritura (relacionados primero, con rollback) → verificación
 * posterior (carreras de unicidad; ver AGENTS.md, "Concurrencia").
 */

export const ABM_MESSAGES = {
  noEncontrado: "No encontramos el registro. Puede que lo hayan borrado.",
  noBorrable: "Este maestro no se puede borrar.",
  validacion: "Revisá los campos marcados.",
  duplicado: (label: string) => `Ya existe otro registro con este ${label.toLowerCase()}.`,
  error: "Ocurrió un error. Probá de nuevo.",
  ...WRITE_MESSAGES,
} as const;

function configFor(slug: string): MaestroConfig | null {
  return isMaestroSlug(slug) ? MAESTRO_CONFIGS[slug] : null;
}

const tableId = (c: MaestroConfig) => TABLES[c.table].id;
const readFields = (c: MaestroConfig) => [...new Set([...Object.values(c.fieldIds), ...c.references])];

function toValues(config: MaestroConfig, fields: Fields): Values {
  const values: Values = {};
  for (const spec of config.spec.fields) {
    const raw = fields[config.fieldIds[spec.key]];
    if (Array.isArray(raw)) values[spec.key] = raw.map(String);
    else if (raw === undefined) values[spec.key] = spec.kind === "checkbox" ? false : spec.kind === "link" || config.links?.[spec.key] ? [] : null;
    else values[spec.key] = raw as Values[string];
  }
  return values;
}

/** Carga la lista y las opciones de links. Todas las páginas (paginación completa del cliente). */
export async function loadMaestro(slug: MaestroSlug): Promise<AbmData> {
  const config = MAESTRO_CONFIGS[slug];
  const client = getAirtableClient();
  const [records, linkData] = await Promise.all([
    client.list(tableId(config), { fields: readFields(config) }),
    loadLinks(config),
  ]);
  const dtos: RecordDTO[] = records.map((r) => ({
    id: r.id,
    values: visibleValues(toValues(config, r.fields), linkData.hidden),
    referenceCount: config.references.reduce((n, f) => n + ((r.fields[f] as unknown[] | undefined)?.length ?? 0), 0),
  }));
  return { records: dtos, labels: linkData.labels, options: linkData.options };
}

/** Saca de los links los registros que `show` oculta (p. ej. Admins en "Empleados asignados"). */
function visibleValues(values: Values, hidden: Record<string, Set<string>>): Values {
  for (const [key, ids] of Object.entries(hidden)) {
    const v = values[key];
    if (Array.isArray(v)) values[key] = v.filter((id) => !ids.has(id));
  }
  return values;
}

async function loadLinks(config: MaestroConfig): Promise<Pick<AbmData, "labels" | "options"> & { hidden: Record<string, Set<string>> }> {
  const labels: AbmData["labels"] = {};
  const options: AbmData["options"] = {};
  const hidden: Record<string, Set<string>> = {};
  const entries = Object.entries(config.links ?? {});
  await Promise.all(
    entries.map(async ([key, source]) => {
      const rows = await getAirtableClient().list(TABLES[source.table].id, { fields: source.fields });
      labels[key] = Object.fromEntries(rows.map((r) => [r.id, source.label(r.fields) || "(sin nombre)"]));
      options[key] = rows
        .filter((r) => !source.allow || source.allow(r.fields))
        .map((r): LinkOption => ({ id: r.id, label: labels[key][r.id] }))
        .sort((a, b) => a.label.localeCompare(b.label, "es"));
      if (source.show) hidden[key] = new Set(rows.filter((r) => !source.show!(r.fields)).map((r) => r.id));
    }),
  );
  return { labels, options, hidden };
}

/** Valida que los links elegidos estén permitidos (o ya estuvieran guardados). */
async function checkLinks(config: MaestroConfig, values: Values, existing?: Values): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const linkKeys = config.spec.fields.filter((f) => f.kind === "link" && Array.isArray(values[f.key]) && (values[f.key] as string[]).length > 0);
  if (linkKeys.length === 0) return errors;
  const { options } = await loadLinks(config);
  for (const spec of linkKeys) {
    const allowed = new Set([...(options[spec.key] ?? []).map((o) => o.id), ...((existing?.[spec.key] as string[] | undefined) ?? [])]);
    if ((values[spec.key] as string[]).some((id) => !allowed.has(id))) errors[spec.key] = FIELD_MESSAGES.link;
  }
  return errors;
}

async function checkUnique(config: MaestroConfig, values: Values, excludeId?: string): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  for (const key of config.unique ?? []) {
    const value = values[key];
    if (value === null || value === undefined || value === "") continue;
    const dups = await findDuplicates(tableId(config), config.fieldIds[key], value, { excludeId });
    if (dups.length > 0) {
      const label = config.spec.fields.find((f) => f.key === key)?.label ?? key;
      errors[key] = ABM_MESSAGES.duplicado(label);
    }
  }
  return errors;
}

/** Valores parseados → campos de Airtable (por ID). Al crear se omiten los vacíos. */
function toFields(config: MaestroConfig, values: Values, mode: "create" | "edit"): Fields {
  const out: Fields = {};
  for (const spec of config.spec.fields as readonly FieldSpec[]) {
    if (!(spec.key in values)) continue;
    const value = values[spec.key];
    const id = config.fieldIds[spec.key];
    if (spec.kind === "link") out[id] = (value as string[] | null) ?? [];
    else if (value === null) {
      if (mode === "edit") out[id] = null;
    } else out[id] = value;
  }
  return out;
}

const fail = (status: 400 | 404 | 405 | 409 | 500 | 503, error: string, fieldErrors?: FieldErrors): ServiceResult<never> => ({
  ok: false,
  status,
  error,
  ...(fieldErrors ? { fieldErrors } : {}),
});

/**
 * Pre-valida todos los payloads (y sus valores de rollback) antes de escribir
 * nada. Un payload inválido es un bug del servidor: se loguean solo la tabla y
 * los IDs de campo involucrados. Devuelve true si todo se puede escribir.
 */
function payloadsAreWritable(config: MaestroConfig, plan: WritePlan, fields: Fields, previous: Fields | undefined): boolean {
  const payloads: [string, Fields, string?][] = [[tableId(config), fields], ...(previous ? [[tableId(config), previous] as [string, Fields]] : [])];
  for (const r of plan.related ?? []) payloads.push([TABLES[r.table].id, r.fields, r.id], [TABLES[r.table].id, r.previous, r.id]);
  const problems = payloads.flatMap(([table, f, recordId]) => {
    const bad = invalidFieldIds(table, f);
    const badRecord = recordId !== undefined && !isRecordId(recordId);
    return bad.length > 0 || badRecord ? [{ table, fields: bad, ...(badRecord ? { recordId: "inválido" } : {}) }] : [];
  });
  if (problems.length === 0) return true;
  console.error("[abm] Payload inválido (bug del servidor)", { problems });
  return false;
}

/** Una verificación por clave única escrita (carreras de unicidad). */
function uniqueChecks(config: MaestroConfig, fields: Fields, id: string, mode: "create" | "edit"): PostWriteCheck[] {
  return (config.unique ?? [])
    .filter((key) => config.fieldIds[key] in fields)
    .map((key) => ({
      name: `unique:${key}`,
      run: async () =>
        (await losesUniqueRace(tableId(config), config.fieldIds[key], fields[config.fieldIds[key]], id, mode))
          ? { error: ABM_MESSAGES.validacion, fieldErrors: { [key]: ABM_MESSAGES.duplicado(labelOf(config, key)) } }
          : null,
    }));
}

const labelOf = (config: MaestroConfig, key: string) => config.spec.fields.find((f) => f.key === key)?.label ?? key;

async function write(
  config: MaestroConfig,
  raw: RawValues,
  target: { mode: "create" } | { mode: "edit"; id: string },
): Promise<ServiceResult<{ id: string }>> {
  const client = getAirtableClient();
  let existingFields: Fields | undefined;
  let existingValues: Values | undefined;
  if (target.mode === "edit") {
    const record = await client.get(tableId(config), target.id, { fields: readFields(config) });
    if (!record) return fail(404, ABM_MESSAGES.noEncontrado);
    existingFields = record.fields;
    existingValues = toValues(config, record.fields);
  }

  // 1. Validación (400) y choques (409). Nada se escribe hasta pasar todo.
  const { values, errors } = validateMaestro(config.spec, raw, target.mode);
  if (Object.keys(errors).length > 0) return fail(400, ABM_MESSAGES.validacion, errors);

  const linkErrors = await checkLinks(config, values, existingValues);
  if (Object.keys(linkErrors).length > 0) return fail(400, ABM_MESSAGES.validacion, linkErrors);

  const id = target.mode === "edit" ? target.id : undefined;
  const uniqueErrors = await checkUnique(config, values, id);
  if (Object.keys(uniqueErrors).length > 0) return fail(409, ABM_MESSAGES.validacion, uniqueErrors);

  const plan = (await config.beforeWrite?.({ mode: target.mode, id, values, existing: existingFields })) ?? {};
  if (plan.invalid && Object.keys(plan.invalid).length > 0) return fail(400, ABM_MESSAGES.validacion, plan.invalid);
  if (plan.conflict) return fail(409, plan.conflict.error, plan.conflict.fieldErrors);

  const fields = { ...toFields(config, values, target.mode), ...(plan.extraFields ?? {}) };
  const previous = existingFields ? previousOf(fields, existingFields) : undefined;
  if (!payloadsAreWritable(config, plan, fields, previous)) return fail(500, ABM_MESSAGES.error);

  // 2. Escritura: relacionados primero (lotes de 10), después el registro.
  const related = plan.related ?? [];
  const tx = new Compensation();
  let savedId: string;
  try {
    for (const table of new Set(related.map((r) => r.table))) {
      const batch = related.filter((r) => r.table === table);
      await tx.update(TABLES[table].id, batch, (i) => injectFault(`cascade:${table}:${i}`));
    }
    if (related.length > 0) injectFault(`cascade:${config.table}`);
    if (target.mode === "create") savedId = await tx.create(tableId(config), fields);
    else {
      await tx.update(tableId(config), [{ id: target.id, fields, previous: previous! }]);
      savedId = target.id;
    }
  } catch (err) {
    // Una sola escritura sin relacionados: el error sigue a apiRoute (404/503/500).
    if (related.length === 0) throw err;
    return (await rollbackAndLog(tx, `${config.spec.slug} ${id ?? "alta"}`))
      ? fail(503, ABM_MESSAGES.revertido)
      : fail(500, ABM_MESSAGES.incompleto);
  }

  // 3. Verificación posterior (fail-closed): conflicto → 409; si no se puede leer → 503. Siempre deshaciendo.
  const checks = uniqueChecks(config, fields, savedId, target.mode);
  if (plan.verify) checks.push({ name: "cascade", run: plan.verify });
  const failed = await runPostWriteChecks(tx, savedId, checks);
  if (failed) return failed;
  return { ok: true, data: { id: savedId } };
}

export async function createMaestro(slug: string, raw: RawValues): Promise<ServiceResult<{ id: string }>> {
  const config = configFor(slug);
  if (!config) return fail(404, ABM_MESSAGES.noEncontrado);
  return write(config, raw, { mode: "create" });
}

export async function updateMaestro(slug: string, id: string, raw: RawValues): Promise<ServiceResult<{ id: string }>> {
  const config = configFor(slug);
  if (!config || !/^rec[A-Za-z0-9]{14}$/.test(id)) return fail(404, ABM_MESSAGES.noEncontrado);
  return write(config, raw, { mode: "edit", id });
}

export interface DeleteCheck {
  /** null = se puede borrar. Si no, el mismo mensaje que daría el 409. */
  blocked: string | null;
  references: { fieldId: string; count: number }[];
}

/** Lee las referencias del registro ahora. 404/405 como el borrado. */
async function checkDeletable(config: MaestroConfig | null, id: string): Promise<ServiceResult<DeleteCheck>> {
  if (!config || !/^rec[A-Za-z0-9]{14}$/.test(id)) return fail(404, ABM_MESSAGES.noEncontrado);
  if (!config.spec.deletable) return fail(405, ABM_MESSAGES.noBorrable);
  const refs = await findReferences(tableId(config), id, config.references);
  if (refs === null) return fail(404, ABM_MESSAGES.noEncontrado);
  const blocked = refs.length === 0 ? null : (config.referencedMessage?.(refs) ?? REFERENCED_MESSAGE);
  return { ok: true, data: { blocked, references: refs } };
}

/**
 * ¿Se puede borrar? Lo usa el formulario antes de pedir confirmación: con
 * referencias muestra el mensaje; sin referencias abre el diálogo. El borrado
 * vuelve a leer las referencias igual (esto es solo un aviso previo).
 */
export async function deleteCheckMaestro(slug: string, id: string): Promise<ServiceResult<DeleteCheck>> {
  return checkDeletable(configFor(slug), id);
}

/**
 * Borra solo si el maestro admite borrado y el registro no tiene referencias.
 * Las referencias se releen inmediatamente antes del delete (no hay
 * transacciones: ver AGENTS.md, "Borrado de Clientes", para la carrera residual).
 */
export async function deleteMaestro(slug: string, id: string): Promise<ServiceResult<{ id: string }>> {
  const config = configFor(slug);
  const check = await checkDeletable(config, id);
  if (!check.ok) return check;
  if (check.data.blocked) return fail(409, check.data.blocked);
  await getAirtableClient().delete(tableId(config!), [id]);
  return { ok: true, data: { id } };
}
