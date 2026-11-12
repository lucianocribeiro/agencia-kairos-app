#!/usr/bin/env node
/**
 * Verifica que ningún secreto llegue al bundle del navegador.
 *
 * Después de `next build`, recorre `.next/static` y busca:
 * - los nombres AIRTABLE_TOKEN, AIRTABLE_BASE_ID, SESSION_SECRET y BOOTSTRAP_ADMIN_PASSWORD;
 * - sus valores, si están definidos en el entorno (incluye .env* que carga Next).
 *
 * Además recorre el código compilado de `.next/server` (sin los .map) y falla si
 * encuentra KAIROS_FAULT_INJECTION: la inyección de fallas del smoke test tiene
 * que quedar fuera del build de producción.
 *
 * Sale con código 1 si encuentra algo. Nunca imprime los valores.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

import nextEnv from "@next/env";

const ROOT = process.cwd();
const STATIC_DIR = join(ROOT, ".next", "static");
const SERVER_DIR = join(ROOT, ".next", "server");
const DEV_ONLY_MARKER = Buffer.from("KAIROS_FAULT_INJECTION");
const NAMES = ["AIRTABLE_TOKEN", "AIRTABLE_BASE_ID", "SESSION_SECRET", "BOOTSTRAP_ADMIN_PASSWORD"];
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

  let serverFiles = 0;
  try {
    for await (const file of walk(SERVER_DIR)) {
      // Los .map llevan el fuente original (no se ejecutan): solo se revisa el código compilado.
      if (file.endsWith(".map")) continue;
      serverFiles++;
      if ((await readFile(file)).includes(DEV_ONLY_MARKER)) findings.push(`${relative(ROOT, file)}: inyección de fallas (solo dev)`);
    }
  } catch {
    findings.push(".next/server: no existe (corré `npm run build`)");
  }

  if (findings.length > 0) {
    console.error(`✖ check:bundle encontró problemas (${findings.length}):`);
    for (const f of findings) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `✔ check:bundle OK · ${files} archivos en .next/static · ${NAMES.length} nombres y ${checkedValues} valores verificados · ${serverFiles} archivos de .next/server sin inyección de fallas.`,
  );
  if (checkedValues === 0) {
    console.log("  (No hay variables definidas en el entorno: solo se verificaron los nombres.)");
  }
}

await main();
