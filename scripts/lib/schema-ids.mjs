/**
 * Lee los IDs de lib/airtable/schema.ts (sin ejecutarlo: es server-only) para
 * que los scripts comparen contra la misma fuente de verdad que la app.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = fileURLToPath(new URL("../../lib/airtable/schema.ts", import.meta.url));

/** @returns {{ id: string, fields: Record<string, string> }} */
export function schemaTable(key, source = readFileSync(SCHEMA_PATH, "utf8")) {
  const re = new RegExp(`\\n  ${key}: \\{\\s*id: "(tbl[A-Za-z0-9]{14})",[\\s\\S]*?fields: \\{([\\s\\S]*?)\\n    \\}`);
  const m = re.exec(source);
  if (!m) throw new Error(`No encontré la tabla "${key}" en lib/airtable/schema.ts`);
  const body = m[2].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const fields = Object.fromEntries([...body.matchAll(/(\w+):\s*"(fld[A-Za-z0-9]{14})"/g)].map((f) => [f[1], f[2]]));
  return { id: m[1], fields };
}

/** Tablas de la base vía Meta API (solo lectura). */
export async function fetchBaseTables(token, baseId, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const type = typeof data.error === "string" ? data.error : data.error?.type;
    throw new Error(`Airtable respondió ${res.status}${type ? ` (${type})` : ""}`);
  }
  return data.tables;
}

/**
 * Compara una tabla real contra los IDs esperados: `expected.fields` es
 * { clave: fieldId } y `names` es { clave: nombre del campo en Airtable }.
 * Devuelve la lista de diferencias (vacía si coincide).
 */
export function diffTable(table, expected, names) {
  const problems = [];
  if (table.id !== expected.id) problems.push(`tabla: real ${table.id} ≠ schema.ts ${expected.id}`);
  for (const [key, name] of Object.entries(names)) {
    const real = table.fields.find((f) => f.name === name);
    const want = expected.fields[key];
    if (!real) problems.push(`${key} ("${name}"): no existe en la base`);
    else if (real.id !== want) problems.push(`${key} ("${name}"): real ${real.id} ≠ schema.ts ${want ?? "(falta)"}`);
  }
  return problems;
}
