#!/usr/bin/env node
/**
 * Crea (o verifica) la tabla "Sincronizaciones ARCA" (CC-F5-03). La lógica está en
 * scripts/lib/setup-sincronizaciones-arca.mjs (testeada en test/setup-sincronizaciones-arca.test.ts).
 *
 * Uso: npm run setup:sincronizaciones-arca [-- --verify]   (lee .env.local)
 * `--verify`: solo lee (GET); nunca crea.
 */
import process from "node:process";

import nextEnv from "@next/env";

import { setupSincronizacionesArca } from "./lib/setup-sincronizaciones-arca.mjs";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

process.exitCode = await setupSincronizacionesArca({
  token: process.env.AIRTABLE_TOKEN,
  baseId: process.env.AIRTABLE_BASE_ID,
  verifyOnly: process.argv.includes("--verify"),
});
