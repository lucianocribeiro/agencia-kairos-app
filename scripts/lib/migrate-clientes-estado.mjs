/**
 * Lógica de `npm run migrate:clientes-estado` (Fase 2, bloque 0), con fetch,
 * escritura del snapshot y salida inyectables (testeable).
 *
 * Clientes Estado pasa de Cliente / Lead / Ex cliente / Perdido a Activo / Inactivo:
 *   1. Snapshot de todos los Clientes (todos los campos, por ID) a un archivo local (gitignored).
 *   2. Precondiciones (aborta sin escribir si alguna falla):
 *      - cada uno de los 7 leads de LEAD_IDS, si todavía existe, sigue en Lead y no
 *        tiene links en Proyectos, Ventas ni Tesorería;
 *      - no hay registros con un Estado sin mapeo (Ex cliente, Perdido, vacío,
 *        otro Lead fuera de la lista);
 *      - las opciones Activo e Inactivo existen en el campo Estado. El script NO las
 *        crea: la Meta API no permite editar opciones de un singleSelect y no se usa
 *        typecast para crearlas de costado (ver README, "Migración de Clientes").
 *   3. --apply: Cliente → Activo (lotes de 10, sin typecast) y borra los leads.
 *   4. Verifica el estado final (relee): cantidad esperada, todos Activo, ninguno con
 *      una opción vieja, ningún lead de la lista. Imprime los IDs borrados.
 *
 * Sin --apply es dry-run: solo GET (más el snapshot local). Idempotente: si ya
 * se aplicó, no hay nada para escribir y solo verifica. Nunca imprime el token.
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
export const NEW_OPTIONS = ["Activo", "Inactivo"];
export const OLD_OPTIONS = ["Cliente", "Lead", "Ex cliente", "Perdido"];
const API = "https://api.airtable.com/v0";

/**
 * @param {{ token?: string, baseId?: string, apply?: boolean, fetch?: typeof fetch,
 *           log?: (s: string) => void, error?: (s: string) => void,
 *           saveSnapshot: (data: unknown) => string, schemaSource?: string }} options
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

  const mode = apply ? "APPLY" : "DRY-RUN";
  log(`Migración Clientes Estado → Activo / Inactivo · ${mode}`);

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

    // 2. Precondiciones
    const problems = [];
    const estadoOf = (r) => r.fields[F.estado] ?? null;
    const links = (r) => [F.proyectos, F.ventas, F.tesoreria].reduce((n, f) => n + (r.fields[f]?.length ?? 0), 0);
    const byId = new Map(records.map((r) => [r.id, r]));
    const leadsPresent = LEAD_IDS.filter((id) => byId.has(id));
    for (const id of leadsPresent) {
      const r = byId.get(id);
      if (estadoOf(r) !== "Lead") problems.push(`${id}: se esperaba Estado Lead y es ${JSON.stringify(estadoOf(r))}`);
      if (links(r) > 0) problems.push(`${id}: tiene ${links(r)} link(s) en Proyectos/Ventas/Tesorería`);
    }
    const leadSet = new Set(LEAD_IDS);
    for (const r of records) {
      if (leadSet.has(r.id)) continue;
      const e = estadoOf(r);
      if (e !== "Cliente" && e !== "Activo" && e !== "Inactivo") problems.push(`${r.id}: Estado ${JSON.stringify(e)} sin mapeo`);
    }
    const choiceNames = (field.options?.choices ?? []).map((c) => c.name);
    const missingOptions = NEW_OPTIONS.filter((o) => !choiceNames.includes(o));
    log(`Opciones del campo Estado: ${choiceNames.join(", ")}`);

    const toUpdate = records.filter((r) => !leadSet.has(r.id) && estadoOf(r) === "Cliente").map((r) => r.id);
    const expectedFinal = records.length - leadsPresent.length;
    log(`Leads a borrar: ${leadsPresent.length} de ${LEAD_IDS.length}${leadsPresent.length < LEAD_IDS.length ? ` (ya borrados: ${LEAD_IDS.filter((id) => !byId.has(id)).join(", ")})` : ""}`);
    for (const id of leadsPresent) log(`  - ${id}`);
    log(`Cliente → Activo: ${toUpdate.length} registros`);
    for (const id of toUpdate) log(`  - ${id}`);
    log(`Estado final esperado: ${expectedFinal} registros, todos Activo`);

    if (problems.length > 0) {
      error(`✖ Precondiciones: ${problems.length} problema(s). No se escribió nada.`);
      for (const p of problems) error(`  - ${p}`);
      return 1;
    }
    if (missingOptions.length > 0) {
      error(`✖ Faltan las opciones ${missingOptions.join(" e ")} en Clientes › Estado. Agregalas desde la interfaz de Airtable (la Meta API no lo permite) y volvé a correr.`);
      if (!apply) log("Dry-run: con las opciones creadas, el plan de arriba es lo que haría --apply.");
      return 1;
    }
    if (!apply) {
      log("Dry-run OK: precondiciones cumplidas. Nada escrito. Corré con --apply para aplicar.");
      return 0;
    }

    // 3. Escrituras
    for (let i = 0; i < toUpdate.length; i += 10) {
      const batch = toUpdate.slice(i, i + 10);
      await call("PATCH", `/${baseId}/${C.id}`, { records: batch.map((id) => ({ id, fields: { [F.estado]: "Activo" } })) });
    }
    log(`Actualizados a Activo: ${toUpdate.length}`);
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
    if (after.length !== expectedFinal) fails.push(`hay ${after.length} registros, se esperaban ${expectedFinal}`);
    for (const r of after) {
      if (leadSet.has(r.id)) fails.push(`${r.id}: el lead sigue existiendo`);
      else if (estadoOf(r) !== "Activo") fails.push(`${r.id}: Estado ${JSON.stringify(estadoOf(r))}`);
      if (OLD_OPTIONS.includes(estadoOf(r))) fails.push(`${r.id}: todavía usa la opción vieja ${estadoOf(r)}`);
    }
    if (fails.length > 0) {
      error(`✖ Verificación final: ${fails.length} problema(s). Restaurá desde el snapshot (${file}) si hace falta.`);
      for (const f of fails) error(`  - ${f}`);
      return 1;
    }
    log(`✔ Verificado: ${after.length} registros, todos Activo, ninguno con una opción vieja.`);
    log("Siguiente paso manual: quitar las opciones viejas (Cliente, Lead, Ex cliente, Perdido) desde la interfaz.");
    return 0;
  } catch (err) {
    error(`✖ ${err instanceof Error ? err.message : "Error inesperado"}`);
    return 1;
  }
}
