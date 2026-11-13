#!/usr/bin/env node
/**
 * Migra Clientes Estado a Activo / Inactivo. La lógica está en
 * scripts/lib/migrate-clientes-estado.mjs (testeada en test/migrate-clientes-estado.test.ts).
 *
 * Uso: npm run migrate:clientes-estado [-- --apply]   (lee .env.local)
 * Sin `--apply` es dry-run (solo lectura). El snapshot queda en backups/ (gitignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
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

process.exitCode = await migrateClientesEstado({
  token: process.env.AIRTABLE_TOKEN,
  baseId: process.env.AIRTABLE_BASE_ID,
  apply: process.argv.includes("--apply"),
  saveSnapshot,
});
