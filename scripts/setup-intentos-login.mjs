#!/usr/bin/env node
/**
 * Crea (o verifica) la tabla "Intentos de login" con la Meta API de Airtable.
 *
 * - Si existe: verifica tipos/opciones y que el ID de tabla y los IDs de campo
 *   coincidan con lib/airtable/schema.ts. Si no coinciden → exit 1 con los IDs reales.
 * - Si no existe: la crea, imprime los IDs nuevos y sale con exit 1
 *   ("Actualizá schema.ts…"), porque la app usa los IDs de schema.ts.
 * - `--verify`: solo lee; nunca crea (exit 1 si no existe).
 *
 * Uso: npm run setup:intentos-login [-- --verify]   (lee .env.local)
 * Imprime solo IDs y nombres; nunca el token.
 */
import process from "node:process";

import nextEnv from "@next/env";

import { diffTable, fetchBaseTables, schemaTable } from "./lib/schema-ids.mjs";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const VERIFY_ONLY = process.argv.includes("--verify");
const TABLE_NAME = "Intentos de login";
const DESCRIPTION = "Registro de intentos de login para bloqueo temporal. Lo escribe sólo el servidor.";
const RESULTADOS = ["Fallido", "Exitoso", "Bloqueado"];
const TIME_ZONE = "America/Argentina/Buenos_Aires";
/** clave en schema.ts → nombre del campo en Airtable */
const NAMES = { email: "Email", ip: "IP", resultado: "Resultado", fecha: "Fecha" };

const FIELDS = [
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

const { AIRTABLE_TOKEN: token, AIRTABLE_BASE_ID: baseId } = process.env;
if (!token || !baseId) {
  console.error("✖ Faltan AIRTABLE_TOKEN o AIRTABLE_BASE_ID en .env.local.");
  process.exit(1);
}

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

function printIds(table) {
  console.log(`  tabla ${table.id}`);
  for (const f of table.fields) {
    const choices = f.options?.choices ? ` [${f.options.choices.map((c) => c.name).join("|")}]` : "";
    console.log(`  ${f.id}  ${f.name} (${f.type})${choices}`);
  }
}

const expected = schemaTable("intentosLogin");
const tables = await fetchBaseTables(token, baseId);
const existing = tables.find((t) => t.name === TABLE_NAME);

if (existing) {
  const problems = [...verifyShape(existing), ...diffTable(existing, expected, NAMES)];
  if (problems.length > 0) {
    console.error(`✖ La tabla ${TABLE_NAME} existe pero no coincide con lib/airtable/schema.ts:`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error("IDs reales:");
    printIds(existing);
    process.exit(1);
  }
  console.log(`✔ ${TABLE_NAME} existe y coincide con lib/airtable/schema.ts (tipos, opciones e IDs).`);
  printIds(existing);
} else if (VERIFY_ONLY) {
  console.error(`✖ La tabla ${TABLE_NAME} no existe (modo --verify: no se crea).`);
  process.exit(1);
} else {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: TABLE_NAME, description: DESCRIPTION, fields: FIELDS }),
  });
  const created = await res.json().catch(() => ({}));
  if (!res.ok) {
    const type = typeof created.error === "string" ? created.error : created.error?.type;
    console.error(`✖ Airtable respondió ${res.status}${type ? ` (${type})` : ""}`);
    process.exit(1);
  }
  console.log(`Tabla ${TABLE_NAME} creada. IDs nuevos:`);
  printIds(created);
  console.error("✖ Actualizá schema.ts con estos IDs antes de usar la app.");
  process.exit(1);
}
