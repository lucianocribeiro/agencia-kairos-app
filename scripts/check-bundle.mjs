#!/usr/bin/env node
/**
 * Verifica que ningún secreto llegue al bundle del navegador.
 *
 * Después de `next build`, recorre `.next/static` y busca:
 * - los nombres AIRTABLE_TOKEN, AIRTABLE_BASE_ID y SESSION_SECRET;
 * - sus valores, si están definidos en el entorno (incluye .env* que carga Next).
 *
 * Sale con código 1 si encuentra algo. Nunca imprime los valores.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

import nextEnv from "@next/env";

const ROOT = process.cwd();
const STATIC_DIR = join(ROOT, ".next", "static");
const NAMES = ["AIRTABLE_TOKEN", "AIRTABLE_BASE_ID", "SESSION_SECRET"];
// Valores muy cortos darían falsos positivos; ningún valor real es tan corto.
const MIN_VALUE_LENGTH = 8;

nextEnv.loadEnvConfig(ROOT, false, { info: () => {}, error: console.error });

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

async function main() {
  try {
    if (!(await stat(STATIC_DIR)).isDirectory()) throw new Error();
  } catch {
    console.error("✖ No existe .next/static. Corré `npm run build` antes de `npm run check:bundle`.");
    process.exit(1);
  }

  const needles = NAMES.map((name) => ({ label: `nombre ${name}`, bytes: Buffer.from(name) }));
  for (const name of NAMES) {
    const value = process.env[name]?.trim();
    if (value && value.length >= MIN_VALUE_LENGTH) {
      needles.push({ label: `valor de ${name}`, bytes: Buffer.from(value) });
    }
  }
  const checkedValues = needles.length - NAMES.length;

  const findings = [];
  let files = 0;
  for await (const file of walk(STATIC_DIR)) {
    files++;
    const content = await readFile(file);
    for (const needle of needles) {
      if (content.includes(needle.bytes)) findings.push(`${relative(ROOT, file)}: ${needle.label}`);
    }
  }

  if (findings.length > 0) {
    console.error(`✖ Se encontraron secretos en el bundle del cliente (${findings.length}):`);
    for (const f of findings) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `✔ check:bundle OK · ${files} archivos en .next/static · ${NAMES.length} nombres y ${checkedValues} valores verificados.`,
  );
  if (checkedValues === 0) {
    console.log("  (No hay variables definidas en el entorno: solo se verificaron los nombres.)");
  }
}

await main();
