/**
 * Lógica de `npm run setup:intentos-login`, con fetch y salida inyectables (testeable).
 *
 * - Si la tabla existe: verifica tipos/opciones y que el ID de tabla y los IDs de
 *   campo coincidan con lib/airtable/schema.ts. Si no coinciden → 1 con los IDs reales.
 * - Si no existe y `verifyOnly`: → 1, sin crear nada (solo GET).
 * - Si no existe: la crea (un único POST), imprime los IDs nuevos y → 1
 *   ("Actualizá schema.ts…"), porque la app usa los IDs de schema.ts.
 *
 * Devuelve el código de salida. Nunca imprime el token.
 */
import { diffTable, fetchBaseTables, schemaTable } from "./schema-ids.mjs";

export const TABLE_NAME = "Intentos de login";
export const UPDATE_SCHEMA_MESSAGE = "Actualizá schema.ts con estos IDs antes de usar la app.";
const DESCRIPTION = "Registro de intentos de login para bloqueo temporal. Lo escribe sólo el servidor.";
const RESULTADOS = ["Fallido", "Exitoso", "Bloqueado"];
const TIME_ZONE = "America/Argentina/Buenos_Aires";
/** clave en schema.ts → nombre del campo en Airtable */
export const NAMES = { email: "Email", ip: "IP", resultado: "Resultado", fecha: "Fecha" };

export const FIELDS = [
  { name: "Email", type: "singleLineText", description: "Email normalizado (trim + minúsculas)." },
  { name: "IP", type: "singleLineText" },
  { name: "Resultado", type: "singleSelect", options: { choices: RESULTADOS.map((name) => ({ name })) } },
  {
    name: "Fecha",
    type: "dateTime",
    description: "La setea el servidor.",
    options: { dateFormat: { name: "iso" }, timeFormat: { name: "24hour" }, timeZone: TIME_ZONE },
  },
];

function verifyShape(table) {
  const problems = [];
  if (table.fields.find((f) => f.id === table.primaryFieldId)?.name !== "Email") problems.push("el campo primario no es Email");
  for (const expected of FIELDS) {
    const field = table.fields.find((f) => f.name === expected.name);
    if (!field) continue; // lo reporta diffTable
    if (field.type !== expected.type) problems.push(`${expected.name} es ${field.type}, se esperaba ${expected.type}`);
    if (expected.name === "Resultado") {
      const names = (field.options?.choices ?? []).map((c) => c.name);
      for (const r of RESULTADOS) if (!names.includes(r)) problems.push(`Resultado no tiene la opción ${r}`);
    }
    if (expected.name === "Fecha" && field.options?.timeZone !== TIME_ZONE) problems.push(`Fecha no usa la zona ${TIME_ZONE}`);
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

/**
 * @param {{ token?: string, baseId?: string, verifyOnly?: boolean, fetch?: typeof fetch,
 *           log?: (s: string) => void, error?: (s: string) => void, schemaSource?: string }} options
 * @returns {Promise<0 | 1>}
 */
export async function setupIntentosLogin({
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

  const expected = schemaTable("intentosLogin", schemaSource);
  let tables;
  try {
    tables = await fetchBaseTables(token, baseId, fetchImpl);
  } catch (err) {
    error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const existing = tables.find((t) => t.name === TABLE_NAME);

  if (existing) {
    const problems = [...verifyShape(existing), ...diffTable(existing, expected, NAMES)];
    if (problems.length > 0) {
      error(`✖ La tabla ${TABLE_NAME} existe pero no coincide con lib/airtable/schema.ts:`);
      for (const p of problems) error(`  - ${p}`);
      error("IDs reales:");
      for (const line of idLines(existing)) error(line);
      return 1;
    }
    log(`✔ ${TABLE_NAME} existe y coincide con lib/airtable/schema.ts (tipos, opciones e IDs).`);
    for (const line of idLines(existing)) log(line);
    return 0;
  }

  if (verifyOnly) {
    error(`✖ La tabla ${TABLE_NAME} no existe (modo --verify: no se crea).`);
    return 1;
  }

  const res = await fetchImpl(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: TABLE_NAME, description: DESCRIPTION, fields: FIELDS }),
  });
  const created = await res.json().catch(() => ({}));
  if (!res.ok) {
    const type = typeof created.error === "string" ? created.error : created.error?.type;
    error(`✖ Airtable respondió ${res.status}${type ? ` (${type})` : ""}`);
    return 1;
  }
  log(`Tabla ${TABLE_NAME} creada. IDs nuevos:`);
  for (const line of idLines(created)) log(line);
  error(`✖ ${UPDATE_SCHEMA_MESSAGE}`);
  return 1;
}
