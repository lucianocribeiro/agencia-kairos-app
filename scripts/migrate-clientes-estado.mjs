#!/usr/bin/env node
/**
 * Migra Clientes Estado a Activo / Inactivo. La lógica está en
 * scripts/lib/migrate-clientes-estado.mjs (testeada en test/migrate-clientes-estado.test.ts).
 *
 * Uso: npm run migrate:clientes-estado [-- --apply]   (lee .env.local)
 * Sin `--apply` es dry-run (solo lectura). El snapshot queda en backups/ (gitignored).
 * `--apply` guarda antes de escribir backups/migrate-clientes-estado.resume.json (0600):
 * no lo borres hasta que la migración termine bien; una corrida a medias lo necesita.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import nextEnv from "@next/env";

import { migrateClientesEstado } from "./lib/migrate-clientes-estado.mjs";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

function saveSnapshot(data) {
  const dir = path.join(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });
  const file = path.join("backups", `clientes-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(path.join(process.cwd(), file), JSON.stringify(data, null, 2), { mode: 0o600 });
  return file;
}

const RESUME_FILE = path.join("backups", "migrate-clientes-estado.resume.json");

function loadResume() {
  const full = path.join(process.cwd(), RESUME_FILE);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch {
    return { invalid: true }; // ilegible → la validación del plan aborta
  }
}

/** Escritura durable: crea (nunca pisa), modo 0600 y fsync antes de seguir. */
function saveResume(data) {
  mkdirSync(path.join(process.cwd(), "backups"), { recursive: true });
  const fd = openSync(path.join(process.cwd(), RESUME_FILE), "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(data, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return RESUME_FILE;
}

process.exitCode = await migrateClientesEstado({
  token: process.env.AIRTABLE_TOKEN,
  baseId: process.env.AIRTABLE_BASE_ID,
  apply: process.argv.includes("--apply"),
  saveSnapshot,
  loadResume,
  saveResume,
});
