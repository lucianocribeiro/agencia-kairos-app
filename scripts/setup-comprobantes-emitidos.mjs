#!/usr/bin/env node
/**
 * Crea (o verifica) la tabla "Comprobantes emitidos", los campos de Clientes y los Conceptos de
 * Parámetros de la factura electrónica (CC-F5-10). La lógica está en
 * scripts/lib/setup-comprobantes-emitidos.mjs (testeada en test/setup-comprobantes-emitidos.test.ts).
 *
 * Uso: npm run setup:comprobantes-emitidos [-- --verify]   (lee .env.local)
 * `--verify`: solo lee (GET); nunca crea.
 */
import process from "node:process";

import nextEnv from "@next/env";

import { setupComprobantesEmitidos } from "./lib/setup-comprobantes-emitidos.mjs";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

process.exitCode = await setupComprobantesEmitidos({
  token: process.env.AIRTABLE_TOKEN,
  baseId: process.env.AIRTABLE_BASE_ID,
  verifyOnly: process.argv.includes("--verify"),
});
