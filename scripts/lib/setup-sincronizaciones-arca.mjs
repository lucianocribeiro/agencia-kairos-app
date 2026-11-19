/**
 * Lógica de `npm run setup:sincronizaciones-arca` (CC-F5-03), con fetch y salida inyectables.
 * Mismo esquema que setup-intentos-login.mjs:
 *
 * - Si la tabla existe: verifica tipos/opciones, el link a Usuarios (y su inverso) y que
 *   los IDs coincidan con lib/airtable/schema.ts. Si no coinciden → 1 con los IDs reales.
 * - Si no existe y `verifyOnly`: → 1, sin crear nada (solo GET).
 * - Si no existe: la crea (POST de la tabla y POST del campo Usuario), imprime los IDs
 *   nuevos y → 1 ("Actualizá schema.ts…"), porque la app usa los IDs de schema.ts.
 *
 * La tabla nunca guarda la CUIT de la empresa, el usuario de ARCA ni la clave fiscal.
 * Devuelve el código de salida. Nunca imprime el token.
 */
import { diffTable, fetchBaseTables, schemaTable } from "./schema-ids.mjs";

export const TABLE_NAME = "Sincronizaciones ARCA";
export const UPDATE_SCHEMA_MESSAGE = "Actualizá schema.ts con estos IDs antes de usar la app.";
const DESCRIPTION =
  "Registro de sincronizaciones con ARCA (Afip SDK). Lo escribe sólo el servidor. Nunca guarda CUIT, usuario ni clave fiscal.";
const TIME_ZONE = "America/Argentina/Buenos_Aires";
export const TIPOS = ["Ventas", "Compras"];
export const ESTADOS = ["En proceso", "Lista para revisar", "Importada", "Error", "Vencida"];
/** Campo inverso que Airtable crea en Usuarios al crear el link. */
export const INVERSE_NAME = "Sincronizaciones ARCA";

/** clave en schema.ts → nombre del campo en Airtable */
export const NAMES = {
  sincronizacion: "Sincronización",
  tipo: "Tipo",
  desde: "Desde",
  hasta: "Hasta",
  usuario: "Usuario",
  jobId: "Job ID",
  estado: "Estado",
  leidas: "Leídas",
  nuevas: "Nuevas",
  yaImportadas: "Ya importadas",
  duplicadas: "Duplicadas",
  conError: "Con error",
  importadas: "Importadas",
  mensaje: "Mensaje",
  iniciada: "Iniciada",
  finalizada: "Finalizada",
};

const date = { dateFormat: { name: "european" } };
const dateTime = { dateFormat: { name: "iso" }, timeFormat: { name: "24hour" }, timeZone: TIME_ZONE };
const count = (name) => ({ name, type: "number", options: { precision: 0 } });
const select = (name, choices) => ({ name, type: "singleSelect", options: { choices: choices.map((c) => ({ name: c })) } });

/** Campos de la tabla (el primero es el primario). Usuario se crea aparte (link). */
export const FIELDS = [
  { name: "Sincronización", type: "singleLineText", description: "Lo arma el servidor: tipo · período · inicio." },
  select("Tipo", TIPOS),
  { name: "Desde", type: "date", options: date },
  { name: "Hasta", type: "date", options: date },
  { name: "Job ID", type: "singleLineText", description: "ID del job de Afip SDK." },
  select("Estado", ESTADOS),
  count("Leídas"),
  count("Nuevas"),
  count("Ya importadas"),
  count("Duplicadas"),
  count("Con error"),
  count("Importadas"),
  { name: "Mensaje", type: "multilineText" },
  { name: "Iniciada", type: "dateTime", options: dateTime },
  { name: "Finalizada", type: "dateTime", options: dateTime },
];

/** El link a Usuarios (quién sincronizó). */
export function usuarioField(usuariosTableId) {
  return { name: "Usuario", type: "multipleRecordLinks", description: "Admin que sincronizó.", options: { linkedTableId: usuariosTableId } };
}

/** Nombres que la tabla nunca puede tener (credenciales). Lo verifica también un test. */
export const FORBIDDEN_NAME = /cuit|clave|password|contrase|usuario arca|username|token/i;

function verifyShape(table, usuariosTableId) {
  const problems = [];
  if (table.fields.find((f) => f.id === table.primaryFieldId)?.name !== "Sincronización") problems.push("el campo primario no es Sincronización");
  for (const expected of [...FIELDS, usuarioField(usuariosTableId)]) {
    const field = table.fields.find((f) => f.name === expected.name);
    if (!field) continue; // lo reporta diffTable
    if (field.type !== expected.type) problems.push(`${expected.name} es ${field.type}, se esperaba ${expected.type}`);
    for (const want of expected.options?.choices ?? []) {
      if (!(field.options?.choices ?? []).some((c) => c.name === want.name)) problems.push(`${expected.name} no tiene la opción ${want.name}`);
    }
    if (expected.type === "dateTime" && field.options?.timeZone !== TIME_ZONE) problems.push(`${expected.name} no usa la zona ${TIME_ZONE}`);
    if (expected.type === "number" && field.options?.precision !== 0) problems.push(`${expected.name} no tiene precisión 0`);
    if (expected.type === "multipleRecordLinks" && field.options?.linkedTableId !== usuariosTableId) problems.push(`${expected.name} no apunta a Usuarios`);
  }
  for (const f of table.fields) {
    if (FORBIDDEN_NAME.test(f.name)) problems.push(`el campo «${f.name}» parece guardar una credencial: no puede existir`);
    if (["formula", "rollup", "lookup", "count", "multipleLookupValues"].includes(f.type)) problems.push(`el campo «${f.name}» es calculado (${f.type}): no puede existir`);
  }
  return problems;
}

function idLines(table) {
  return [
    `  tabla ${table.id}`,
    ...table.fields.map((f) => {
      const choices = f.options?.choices ? ` [${f.options.choices.map((c) => c.name).join("|")}]` : "";
      return `  ${f.id}  ${f.name} (${f.type})${choices}`;
    }),
  ];
}

function inverseLine(usuarios) {
  const inverse = usuarios?.fields.find((f) => f.name === INVERSE_NAME);
  return inverse ? `  ${inverse.id}  Usuarios › ${INVERSE_NAME} (inverso de Usuario)` : `  (Usuarios › ${INVERSE_NAME} no existe)`;
}

async function post(fetchImpl, url, token, body) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const type = typeof data.error === "string" ? data.error : data.error?.type;
    throw new Error(`Airtable respondió ${res.status}${type ? ` (${type})` : ""}`);
  }
  return data;
}

/**
 * @param {{ token?: string, baseId?: string, verifyOnly?: boolean, fetch?: typeof fetch,
 *           log?: (s: string) => void, error?: (s: string) => void, schemaSource?: string }} options
 * @returns {Promise<0 | 1>}
 */
export async function setupSincronizacionesArca({
  token,
  baseId,
  verifyOnly = false,
  fetch: fetchImpl = fetch,
  log = console.log,
  error = console.error,
  schemaSource,
}) {
  if (!token || !baseId) {
    error("✖ Faltan AIRTABLE_TOKEN o AIRTABLE_BASE_ID en .env.local.");
    return 1;
  }
  const usuariosTableId = schemaTable("usuarios", schemaSource).id;

  let tables;
  try {
    tables = await fetchBaseTables(token, baseId, fetchImpl);
  } catch (err) {
    error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const existing = tables.find((t) => t.name === TABLE_NAME);
  const usuarios = tables.find((t) => t.id === usuariosTableId);

  if (existing) {
    let expected = null;
    try {
      expected = schemaTable("sincronizacionesArca", schemaSource);
    } catch {
      // schema.ts todavía no tiene la tabla: se informa abajo con los IDs reales
    }
    const problems = verifyShape(existing, usuariosTableId);
    if (!expected) problems.push("lib/airtable/schema.ts no tiene la tabla sincronizacionesArca");
    else problems.push(...diffTable(existing, expected, NAMES));
    const inverse = usuarios?.fields.find((f) => f.name === INVERSE_NAME);
    const want = schemaTable("usuarios", schemaSource).fields.sincronizacionesArca;
    if (!inverse) problems.push(`Usuarios no tiene el campo inverso «${INVERSE_NAME}»`);
    else if (inverse.id !== want) problems.push(`usuarios.sincronizacionesArca ("${INVERSE_NAME}"): real ${inverse.id} ≠ schema.ts ${want ?? "(falta)"}`);
    if (problems.length > 0) {
      error(`✖ La tabla ${TABLE_NAME} existe pero no coincide con lib/airtable/schema.ts:`);
      for (const p of problems) error(`  - ${p}`);
      error("IDs reales:");
      for (const line of [...idLines(existing), inverseLine(usuarios)]) error(line);
      return 1;
    }
    log(`✔ ${TABLE_NAME} existe y coincide con lib/airtable/schema.ts (tipos, opciones, link e IDs).`);
    for (const line of [...idLines(existing), inverseLine(usuarios)]) log(line);
    return 0;
  }

  if (verifyOnly) {
    error(`✖ La tabla ${TABLE_NAME} no existe (modo --verify: no se crea).`);
    return 1;
  }

  let created;
  try {
    created = await post(fetchImpl, `https://api.airtable.com/v0/meta/bases/${baseId}/tables`, token, { name: TABLE_NAME, description: DESCRIPTION, fields: FIELDS });
    const usuario = await post(fetchImpl, `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${created.id}/fields`, token, usuarioField(usuariosTableId));
    created.fields.push(usuario);
  } catch (err) {
    error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    if (created) error(`  La tabla quedó creada (${created.id}) sin el campo Usuario: corré el script de nuevo para verificarla.`);
    return 1;
  }
  let after = tables;
  try {
    after = await fetchBaseTables(token, baseId, fetchImpl);
  } catch {
    // los IDs de la tabla ya están; el inverso se ve con --verify
  }
  log(`Tabla ${TABLE_NAME} creada. IDs nuevos:`);
  for (const line of [...idLines(created), inverseLine(after.find((t) => t.id === usuariosTableId))]) log(line);
  error(`✖ ${UPDATE_SCHEMA_MESSAGE}`);
  return 1;
}
