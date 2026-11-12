#!/usr/bin/env node
/**
 * Crea (o verifica) la tabla "Intentos de login". La lógica está en
 * scripts/lib/setup-intentos-login.mjs (testeada en test/setup-intentos-login.test.ts).
 *
 * Uso: npm run setup:intentos-login [-- --verify]   (lee .env.local)
 * `--verify`: solo lee (GET); nunca crea.
 */
import process from "node:process";

import nextEnv from "@next/env";

import { setupIntentosLogin } from "./lib/setup-intentos-login.mjs";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

process.exitCode = await setupIntentosLogin({
  token: process.env.AIRTABLE_TOKEN,
  baseId: process.env.AIRTABLE_BASE_ID,
  verifyOnly: process.argv.includes("--verify"),
});
