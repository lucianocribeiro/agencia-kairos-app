#!/usr/bin/env node
/**
 * Crea (o verifica) la tabla "Intentos de login" con la Meta API de Airtable.
 * Idempotente: si ya existe una tabla con ese nombre, verifica sus campos y la reutiliza.
 *
 * Uso: npm run setup:intentos-login   (lee .env.local; necesita scope schema.bases:write)
 * Imprime solo IDs y nombres; nunca el token.
 */
import process from "node:process";

import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const TABLE_NAME = "Intentos de login";
const DESCRIPTION = "Registro de intentos de login para bloqueo temporal. Lo escribe sólo el servidor.";
const RESULTADOS = ["Fallido", "Exitoso", "Bloqueado"];
const TIME_ZONE = "America/Argentina/Buenos_Aires";

const FIELDS = [
  { name: "Email", type: "singleLineText", description: "Email normalizado (trim + minúsculas)." },
  { name: "IP", type: "singleLineText" },
  {
    name: "Resultado",
    type: "singleSelect",
    options: { choices: RESULTADOS.map((name) => ({ name })) },
  },
  {
    name: "Fecha",
    type: "dateTime",
    description: "La setea el servidor.",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: TIME_ZONE,
    },
  },
];

const { AIRTABLE_TOKEN: token, AIRTABLE_BASE_ID: baseId } = process.env;
if (!token || !baseId) {
  console.error("✖ Faltan AIRTABLE_TOKEN o AIRTABLE_BASE_ID en .env.local.");
  process.exit(1);
}

const url = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function api(method, body) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const type = typeof data.error === "string" ? data.error : data.error?.type;
    throw new Error(`Airtable respondió ${res.status}${type ? ` (${type})` : ""}`);
  }
  return data;
}

function verify(table) {
  const problems = [];
  if (table.fields[0]?.id !== table.primaryFieldId || table.fields.find((f) => f.id === table.primaryFieldId)?.name !== "Email") {
    problems.push("el campo primario no es Email");
  }
  for (const expected of FIELDS) {
    const field = table.fields.find((f) => f.name === expected.name);
    if (!field) {
      problems.push(`falta el campo ${expected.name}`);
      continue;
    }
    if (field.type !== expected.type) problems.push(`${expected.name} es ${field.type}, se esperaba ${expected.type}`);
    if (expected.name === "Resultado") {
      const names = (field.options?.choices ?? []).map((c) => c.name);
      for (const r of RESULTADOS) if (!names.includes(r)) problems.push(`Resultado no tiene la opción ${r}`);
    }
    if (expected.name === "Fecha" && field.options?.timeZone !== TIME_ZONE) {
      problems.push(`Fecha no usa la zona ${TIME_ZONE}`);
    }
  }
  return problems;
}

function print(table, status) {
  console.log(`✔ ${TABLE_NAME} ${status}: ${table.id}`);
  for (const f of table.fields) {
    const choices = f.options?.choices ? ` [${f.options.choices.map((c) => c.name).join("|")}]` : "";
    console.log(`  ${f.id}  ${f.name} (${f.type})${choices}`);
  }
}

const { tables } = await api("GET");
const existing = tables.find((t) => t.name === TABLE_NAME);

if (existing) {
  const problems = verify(existing);
  if (problems.length > 0) {
    console.error(`✖ La tabla ${TABLE_NAME} ya existe pero no coincide:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  print(existing, "ya existía y se reutiliza");
} else {
  const created = await api("POST", { name: TABLE_NAME, description: DESCRIPTION, fields: FIELDS });
  const problems = verify(created);
  if (problems.length > 0) {
    console.error("✖ Tabla creada pero la verificación falló:", problems.join("; "));
    process.exit(1);
  }
  print(created, "creada");
}
