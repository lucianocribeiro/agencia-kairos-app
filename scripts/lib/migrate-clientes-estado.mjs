/**
 * Lógica de `npm run migrate:clientes-estado` (Fase 2, bloque 0), con fetch,
 * archivos y salida inyectables (testeable).
 *
 * Clientes Estado pasa de Cliente / Lead / Ex cliente / Perdido a Activo / Inactivo:
 *   1. Snapshot de todos los Clientes (todos los campos, por ID) a un archivo local (gitignored).
 *   2. Precondiciones. Sin archivo de reanudación (primera corrida), aborta sin escribir salvo que:
 *      - la tabla tenga exactamente 16 registros: 9 con Estado Cliente y 7 con Estado Lead;
 *      - los 7 de LEAD_IDS estén todos presentes, en Lead y sin links en Proyectos, Ventas ni Tesorería;
 *      - existan las opciones Activo e Inactivo (el script NO las crea; nunca usa typecast).
 *   3. --apply: ANTES de la primera escritura guarda el archivo de reanudación (snapshot
 *      original + plan, modo 0600, fsync). Después: Cliente → Activo (lotes de 10) y borra los leads.
 *   4. Reanudación: si una corrida anterior quedó a medias, la siguiente usa el archivo. Solo
 *      acepta que falten leads si el archivo existe, su plan es este plan (los mismos 7 leads,
 *      9 clientes que coinciden con su snapshot) y los que faltan están en él. Si no, aborta.
 *   5. Verificación final (relee): exactamente 9 registros, sus IDs son exactamente los 9 del
 *      plan, todos Activo y ninguno con una opción vieja.
 *
 * Sin --apply es dry-run: solo GET (más el snapshot local). Nunca imprime el token.
 * Los literales de las opciones viejas solo viven acá y en lib/abm/cliente-estado.ts.
 */
import { schemaTable } from "./schema-ids.mjs";

export const LEAD_IDS = [
  "rec2zk98jFVRgypzy", // APLA
  "rec49xCI6wtMQCiN3", // Asia Solutions
  "rec7oRkDFlAMd7ZJU", // Luciano Mastrángelo
  "recJW2mZwPXxMkz8g", // Fernando García Soria
  "recQFZ8vmVtGgEHfO", // Florencia
  "recjchvQeiDARneRw", // Global Blue
  "recmGXqFAwriUrpgt", // Tomás Garay
];
export const LEGACY_CLIENTE = "Cliente";
export const LEGACY_LEAD = "Lead";
export const OLD_OPTIONS = [LEGACY_CLIENTE, LEGACY_LEAD, "Ex cliente", "Perdido"];
export const ACTIVO = "Activo";
export const NEW_OPTIONS = [ACTIVO, "Inactivo"];
export const EXPECTED = { total: 16, clientes: 9, leads: 7 };
export const RESUME_VERSION = 1;
const API = "https://api.airtable.com/v0";

const sorted = (ids) => [...ids].sort();
const sameList = (a, b) => a.length === b.length && sorted(a).every((x, i) => x === sorted(b)[i]);

/**
 * El plan que corresponde a un snapshot de primera corrida (null si el snapshot no cumple).
 * @returns {{ leadIds: string[], clienteIds: string[] } | null}
 */
export function planFromSnapshot(records, F) {
  const clienteIds = records.filter((r) => r.fields[F.estado] === LEGACY_CLIENTE).map((r) => r.id);
  const leadIds = records.filter((r) => r.fields[F.estado] === LEGACY_LEAD).map((r) => r.id);
  if (records.length !== EXPECTED.total || clienteIds.length !== EXPECTED.clientes || !sameList(leadIds, LEAD_IDS)) return null;
  return { leadIds: sorted(leadIds), clienteIds: sorted(clienteIds) };
}

/**
 * @param {{ token?: string, baseId?: string, apply?: boolean, fetch?: typeof fetch,
 *           log?: (s: string) => void, error?: (s: string) => void,
 *           saveSnapshot: (data: unknown) => string,
 *           loadResume: () => unknown | null, saveResume: (data: unknown) => string,
 *           schemaSource?: string }} options
 * @returns {Promise<0 | 1>}
 */
export async function migrateClientesEstado({
  token,
  baseId,
  apply = false,
  fetch: fetchImpl = fetch,
  log = console.log,
  error = console.error,
  saveSnapshot,
  loadResume,
  saveResume,
  schemaSource,
}) {
  if (!token || !baseId) {
    error("✖ Faltan AIRTABLE_TOKEN o AIRTABLE_BASE_ID en .env.local.");
    return 1;
  }
  const C = schemaTable("clientes", schemaSource);
  const F = C.fields;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function call(method, path, body) {
    const res = await fetchImpl(`${API}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const type = typeof data.error === "string" ? data.error : data.error?.type;
      throw new Error(`Airtable respondió ${res.status} a ${method}${type ? ` (${type})` : ""}`);
    }
    return data;
  }

  async function listAll() {
    const out = [];
    let offset;
    do {
      const q = new URLSearchParams({ returnFieldsByFieldId: "true", pageSize: "100" });
      if (offset) q.set("offset", offset);
      const page = await call("GET", `/${baseId}/${C.id}?${q}`);
      out.push(...page.records);
      offset = page.offset;
    } while (offset);
    return out;
  }

  const abort = (title, problems = []) => {
    error(`✖ ${title} No se escribió nada.`);
    for (const p of problems) error(`  - ${p}`);
    return 1;
  };

  log(`Migración Clientes Estado → Activo / Inactivo · ${apply ? "APPLY" : "DRY-RUN"}`);

  try {
    // 1. Snapshot
    const meta = await call("GET", `/meta/bases/${baseId}/tables`);
    const field = meta.tables?.find((t) => t.id === C.id)?.fields?.find((f) => f.id === F.estado);
    if (!field) {
      error(`✖ No encontré el campo Estado (${F.estado}) en la tabla ${C.id}.`);
      return 1;
    }
    const records = await listAll();
    const file = saveSnapshot({ takenAt: new Date().toISOString(), table: C.id, estadoField: field, records });
    log(`Snapshot: ${records.length} registros → ${file}`);
    const choiceNames = (field.options?.choices ?? []).map((c) => c.name);
    log(`Opciones del campo Estado: ${choiceNames.join(", ")}`);

    const estadoOf = (r) => r.fields[F.estado] ?? null;
    const links = (r) => [F.proyectos, F.ventas, F.tesoreria].reduce((n, f) => n + (r.fields[f]?.length ?? 0), 0);
    const byId = new Map(records.map((r) => [r.id, r]));

    // 2. Plan: de la primera corrida (estado actual) o del archivo de reanudación.
    const resume = loadResume();
    let plan;
    let resumed = false;
    if (resume === null || resume === undefined) {
      const problems = [];
      const leadsMissing = LEAD_IDS.filter((id) => !byId.has(id));
      if (leadsMissing.length > 0) problems.push(`faltan leads (sin archivo de reanudación no se acepta): ${leadsMissing.join(", ")}`);
      for (const id of LEAD_IDS.filter((x) => byId.has(x))) {
        const r = byId.get(id);
        if (estadoOf(r) !== LEGACY_LEAD) problems.push(`${id}: se esperaba Estado ${LEGACY_LEAD} y es ${JSON.stringify(estadoOf(r))}`);
        if (links(r) > 0) problems.push(`${id}: tiene ${links(r)} link(s) en Proyectos/Ventas/Tesorería`);
      }
      const nCliente = records.filter((r) => estadoOf(r) === LEGACY_CLIENTE).length;
      const nLead = records.filter((r) => estadoOf(r) === LEGACY_LEAD).length;
      if (records.length !== EXPECTED.total || nCliente !== EXPECTED.clientes || nLead !== EXPECTED.leads) {
        problems.push(`se esperaban ${EXPECTED.total} registros (${EXPECTED.clientes} ${LEGACY_CLIENTE} + ${EXPECTED.leads} ${LEGACY_LEAD}); hay ${records.length} (${nCliente} ${LEGACY_CLIENTE}, ${nLead} ${LEGACY_LEAD}, ${records.length - nCliente - nLead} otros)`);
      }
      if (problems.length > 0) return abort(`Precondiciones (primera corrida): ${problems.length} problema(s).`, problems);
      plan = planFromSnapshot(records, F);
      if (!plan) return abort("Precondiciones: el snapshot no da un plan válido.");
    } else {
      resumed = true;
      const problems = [];
      const fromFile = resume?.plan;
      const expectedPlan = Array.isArray(resume?.snapshot) ? planFromSnapshot(resume.snapshot, F) : null;
      if (resume?.version !== RESUME_VERSION || resume?.table !== C.id) problems.push("el archivo de reanudación no es de esta migración/tabla");
      else if (!expectedPlan || !fromFile) problems.push("el archivo de reanudación no tiene un snapshot original válido");
      else if (!sameList(fromFile.leadIds ?? [], expectedPlan.leadIds) || !sameList(fromFile.clienteIds ?? [], expectedPlan.clienteIds)) {
        problems.push("el plan del archivo no coincide con su snapshot original");
      }
      if (problems.length === 0) {
        plan = { leadIds: sorted(fromFile.leadIds), clienteIds: sorted(fromFile.clienteIds) };
        const planned = new Set([...plan.leadIds, ...plan.clienteIds]);
        for (const r of records) if (!planned.has(r.id)) problems.push(`${r.id}: registro que no está en el plan`);
        for (const id of plan.clienteIds) {
          const r = byId.get(id);
          if (!r) problems.push(`${id}: cliente del plan que ya no existe`);
          else if (estadoOf(r) !== LEGACY_CLIENTE && estadoOf(r) !== ACTIVO) problems.push(`${id}: Estado ${JSON.stringify(estadoOf(r))}`);
        }
        for (const id of plan.leadIds.filter((x) => byId.has(x))) {
          const r = byId.get(id);
          if (estadoOf(r) !== LEGACY_LEAD) problems.push(`${id}: se esperaba Estado ${LEGACY_LEAD} y es ${JSON.stringify(estadoOf(r))}`);
          if (links(r) > 0) problems.push(`${id}: tiene ${links(r)} link(s) en Proyectos/Ventas/Tesorería`);
        }
      }
      if (problems.length > 0) return abort(`Reanudación: ${problems.length} problema(s).`, problems);
      log(`Reanudando con el archivo de reanudación (creado ${resume.createdAt ?? "?"}).`);
    }

    const missingOptions = NEW_OPTIONS.filter((o) => !choiceNames.includes(o));
    const leadsPresent = plan.leadIds.filter((id) => byId.has(id));
    const toUpdate = plan.clienteIds.filter((id) => estadoOf(byId.get(id)) === LEGACY_CLIENTE);
    log(`Leads a borrar: ${leadsPresent.length} de ${plan.leadIds.length}${leadsPresent.length < plan.leadIds.length ? ` (ya borrados según el plan: ${plan.leadIds.filter((id) => !byId.has(id)).join(", ")})` : ""}`);
    for (const id of leadsPresent) log(`  - ${id}`);
    log(`${LEGACY_CLIENTE} → ${ACTIVO}: ${toUpdate.length} de ${plan.clienteIds.length}`);
    for (const id of toUpdate) log(`  - ${id}`);
    log(`Estado final esperado: ${plan.clienteIds.length} registros (los del plan), todos ${ACTIVO}`);

    if (missingOptions.length > 0) {
      return abort(`Faltan las opciones ${missingOptions.join(" e ")} en Clientes › Estado. Agregalas desde la interfaz de Airtable (la Meta API no lo permite) y volvé a correr.`);
    }
    if (!apply) {
      log(`Dry-run OK: precondiciones cumplidas${resumed ? " (reanudación)" : ""}. Nada escrito. Corré con --apply para aplicar.`);
      return 0;
    }

    // 3. Archivo de reanudación ANTES de la primera escritura (solo en la primera corrida).
    if (!resumed) {
      const resumeFile = saveResume({ version: RESUME_VERSION, table: C.id, createdAt: new Date().toISOString(), snapshot: records, plan });
      log(`Archivo de reanudación: ${resumeFile}`);
    }
    for (let i = 0; i < toUpdate.length; i += 10) {
      const batch = toUpdate.slice(i, i + 10);
      await call("PATCH", `/${baseId}/${C.id}`, { records: batch.map((id) => ({ id, fields: { [F.estado]: ACTIVO } })) });
    }
    log(`Actualizados a ${ACTIVO}: ${toUpdate.length}`);
    const deleted = [];
    for (let i = 0; i < leadsPresent.length; i += 10) {
      const batch = leadsPresent.slice(i, i + 10);
      const q = batch.map((id) => `records[]=${encodeURIComponent(id)}`).join("&");
      const res = await call("DELETE", `/${baseId}/${C.id}?${q}`);
      deleted.push(...(res.records ?? []).filter((r) => r.deleted).map((r) => r.id));
    }
    log(`Borrados: ${deleted.length}${deleted.length ? ` → ${deleted.join(", ")}` : ""}`);

    // 4. Verificación
    const after = await listAll();
    const fails = [];
    if (after.length !== EXPECTED.clientes) fails.push(`hay ${after.length} registros, se esperaban ${EXPECTED.clientes}`);
    if (!sameList(after.map((r) => r.id), plan.clienteIds)) fails.push("los IDs finales no son exactamente los 9 del plan");
    for (const r of after) {
      if (estadoOf(r) !== ACTIVO) fails.push(`${r.id}: Estado ${JSON.stringify(estadoOf(r))}`);
      if (OLD_OPTIONS.includes(estadoOf(r))) fails.push(`${r.id}: todavía usa la opción vieja ${estadoOf(r)}`);
    }
    if (fails.length > 0) {
      error(`✖ Verificación final: ${fails.length} problema(s). Snapshot original: ${file} y el archivo de reanudación.`);
      for (const f of fails) error(`  - ${f}`);
      return 1;
    }
    log(`✔ Verificado: ${after.length} registros (los del plan), todos ${ACTIVO}, ninguno con una opción vieja.`);
    log(`IDs borrados en total (plan): ${plan.leadIds.join(", ")}`);
    log("Siguiente paso manual: quitar las opciones viejas (Cliente, Lead, Ex cliente, Perdido) desde la interfaz.");
    return 0;
  } catch (err) {
    error(`✖ ${err instanceof Error ? err.message : "Error inesperado"}`);
    return 1;
  }
}
