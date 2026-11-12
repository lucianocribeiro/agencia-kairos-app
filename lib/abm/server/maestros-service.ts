import "server-only";

import { getAirtableClient, type Fields } from "@/lib/airtable/client";
import { findDuplicates, findReferences, REFERENCED_MESSAGE } from "@/lib/airtable/integrity";
import { TABLES } from "@/lib/airtable/schema";
import type { FieldErrors, FieldSpec, RawValues, Values } from "@/lib/abm/fields";
import { FIELD_MESSAGES } from "@/lib/abm/fields";
import { isMaestroSlug, validateMaestro, type MaestroSlug } from "@/lib/abm/maestros";
import type { AbmData, LinkOption, RecordDTO, ServiceResult } from "@/lib/abm/types";
import { describeError } from "@/lib/auth/users";
import { MAESTRO_CONFIGS, type MaestroConfig } from "./maestros-config";

/**
 * ABM genérico de Maestros. Cada operación lee la config de la tabla y aplica,
 * en este orden: parseo y reglas del spec (las mismas que el formulario) →
 * links permitidos → unicidad → reglas de servidor (beforeWrite) → escritura.
 */

export const ABM_MESSAGES = {
  noEncontrado: "No encontramos el registro. Puede que lo hayan borrado.",
  noBorrable: "Este maestro no se puede borrar.",
  validacion: "Revisá los campos marcados.",
  duplicado: (label: string) => `Ya existe otro registro con este ${label.toLowerCase()}.`,
  error: "Ocurrió un error. Probá de nuevo.",
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
    values: toValues(config, r.fields),
    referenceCount: config.references.reduce((n, f) => n + ((r.fields[f] as unknown[] | undefined)?.length ?? 0), 0),
  }));
  return { records: dtos, ...linkData };
}

async function loadLinks(config: MaestroConfig): Promise<Pick<AbmData, "labels" | "options">> {
  const labels: AbmData["labels"] = {};
  const options: AbmData["options"] = {};
  const entries = Object.entries(config.links ?? {});
  await Promise.all(
    entries.map(async ([key, source]) => {
      const rows = await getAirtableClient().list(TABLES[source.table].id, { fields: source.fields });
      labels[key] = Object.fromEntries(rows.map((r) => [r.id, source.label(r.fields) || "(sin nombre)"]));
      options[key] = rows
        .filter((r) => !source.allow || source.allow(r.fields))
        .map((r): LinkOption => ({ id: r.id, label: labels[key][r.id] }))
        .sort((a, b) => a.label.localeCompare(b.label, "es"));
    }),
  );
  return { labels, options };
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

const fail = (status: 400 | 404 | 405 | 409 | 500, error: string, fieldErrors?: FieldErrors): ServiceResult<never> => ({
  ok: false,
  status,
  error,
  ...(fieldErrors ? { fieldErrors } : {}),
});

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

  const { values, errors } = validateMaestro(config.spec, raw, target.mode);
  if (Object.keys(errors).length > 0) return fail(400, ABM_MESSAGES.validacion, errors);

  const linkErrors = await checkLinks(config, values, existingValues);
  if (Object.keys(linkErrors).length > 0) return fail(400, ABM_MESSAGES.validacion, linkErrors);

  const id = target.mode === "edit" ? target.id : undefined;
  const uniqueErrors = await checkUnique(config, values, id);
  if (Object.keys(uniqueErrors).length > 0) return fail(409, ABM_MESSAGES.validacion, uniqueErrors);

  const plan = (await config.beforeWrite?.({ mode: target.mode, id, values, existing: existingFields })) ?? {};
  if (plan.conflict) return fail(409, plan.conflict);
  if (plan.fieldErrors && Object.keys(plan.fieldErrors).length > 0) return fail(409, ABM_MESSAGES.validacion, plan.fieldErrors);

  const fields = { ...toFields(config, values, target.mode), ...(plan.extraFields ?? {}) };
  let savedId: string;
  if (target.mode === "create") {
    const [created] = await client.create(tableId(config), [fields], { returnFields: [] });
    savedId = created.id;
  } else {
    await client.update(tableId(config), [{ id: target.mode === "edit" ? target.id : "", fields }], { returnFields: [] });
    savedId = target.id;
  }

  if (plan.after) {
    try {
      await plan.after();
    } catch (err) {
      console.error("[abm] Falló la actualización posterior", describeError(err));
      return fail(500, "Se guardó el registro, pero no se pudieron actualizar los registros relacionados. Probá guardarlo de nuevo.");
    }
  }
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

/** Borra solo si el maestro admite borrado y el registro no tiene referencias. */
export async function deleteMaestro(slug: string, id: string): Promise<ServiceResult<{ id: string }>> {
  const config = configFor(slug);
  if (!config || !/^rec[A-Za-z0-9]{14}$/.test(id)) return fail(404, ABM_MESSAGES.noEncontrado);
  if (!config.spec.deletable) return fail(405, ABM_MESSAGES.noBorrable);
  const refs = await findReferences(tableId(config), id, config.references);
  if (refs === null) return fail(404, ABM_MESSAGES.noEncontrado);
  if (refs.length > 0) return fail(409, REFERENCED_MESSAGE);
  await getAirtableClient().delete(tableId(config), [id]);
  return { ok: true, data: { id } };
}
