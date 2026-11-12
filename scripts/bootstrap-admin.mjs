#!/usr/bin/env node
/**
 * Crea el primer Admin si no existe. Uso local únicamente: npm run bootstrap:admin
 *
 * Lee .env.local (AIRTABLE_TOKEN, AIRTABLE_BASE_ID, BOOTSTRAP_ADMIN_PASSWORD).
 * BOOTSTRAP_ADMIN_PASSWORD nunca se configura en Vercel.
 *
 * Orden:
 * 1. Rechaza (exit 1) si BOOTSTRAP_ADMIN_PASSWORD no cumple la política de
 *    lib/auth/password.ts (10+ caracteres, máx. 72 bytes). No llama a Airtable.
 * 2. Verifica que los IDs de Usuarios coincidan con lib/airtable/schema.ts y con
 *    la base real (Meta API, solo lectura). Si no → exit 1 con los IDs reales.
 * 3. Si ya hay un usuario con ese email (sin distinguir mayúsculas), no cambia nada.
 * 4. Si no, lo crea. El hash sale de hashNewPassword (lib/auth/password.ts).
 *
 * Nunca imprime la contraseña ni el hash.
 * Se corre con `node --experimental-strip-types` para importar lib/auth/password.ts.
 */
import process from "node:process";

import nextEnv from "@next/env";

import { checkNewPassword, hashNewPassword } from "../lib/auth/password.ts";
import { diffTable, fetchBaseTables, schemaTable } from "./lib/schema-ids.mjs";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

export const IDS = {
  usuarios: "tblzdplcR97Ltj6vi",
  nombre: "fldB9W48Cav5XRObU",
  email: "fld6Opt1EZhun7vKN",
  rol: "fld3aCCODi0smvQQG",
  estado: "fldrlPu1qQZVtTjKw",
  sigla: "fldPQ8WcmyMJqJOXl",
  passwordHash: "fldbKH5lVR1bEpfqV",
  debeCambiarPassword: "fldTuOm2vDwBhiGBB",
};

/** clave en schema.ts → nombre del campo en Airtable */
const NAMES = {
  nombre: "Nombre",
  email: "Email",
  rol: "Rol",
  estado: "Estado",
  sigla: "Sigla",
  passwordHash: "Password hash",
  debeCambiarPassword: "Debe cambiar password",
};

const ADMIN = {
  nombre: "Luciano Ribeiro",
  email: "luciano@agenciakairos.net",
  sigla: "LR",
};

function exit(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function main() {
  const { AIRTABLE_TOKEN: token, AIRTABLE_BASE_ID: baseId, BOOTSTRAP_ADMIN_PASSWORD: password } = process.env;
  const missing = ["AIRTABLE_TOKEN", "AIRTABLE_BASE_ID", "BOOTSTRAP_ADMIN_PASSWORD"].filter((k) => !process.env[k]);
  if (missing.length > 0) exit(`Faltan en .env.local: ${missing.join(", ")}`);

  // 1. Política de contraseña (antes de cualquier llamada a Airtable).
  const problem = checkNewPassword(password);
  if (problem) exit(`BOOTSTRAP_ADMIN_PASSWORD no es válida: ${problem}`);

  // 2. IDs: constantes del script = schema.ts = base real.
  const expected = schemaTable("usuarios");
  const local = Object.entries(NAMES).filter(([key]) => IDS[key] !== expected.fields[key]).map(([key]) => key);
  if (IDS.usuarios !== expected.id || local.length > 0) {
    exit(`Los IDs de este script no coinciden con lib/airtable/schema.ts (${[IDS.usuarios !== expected.id ? "tabla" : null, ...local].filter(Boolean).join(", ")}).`);
  }
  const usuarios = (await fetchBaseTables(token, baseId)).find((t) => t.id === expected.id || t.name === "Usuarios");
  if (!usuarios) exit("No encontré la tabla Usuarios en la base.");
  const diffs = diffTable(usuarios, expected, NAMES);
  if (diffs.length > 0) {
    console.error("✖ La tabla Usuarios de la base no coincide con lib/airtable/schema.ts:");
    for (const d of diffs) console.error(`  - ${d}`);
    console.error("IDs reales:");
    console.error(`  tabla ${usuarios.id}`);
    for (const f of usuarios.fields) console.error(`  ${f.id}  ${f.name}`);
    process.exit(1);
  }

  const base = `https://api.airtable.com/v0/${baseId}/${IDS.usuarios}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const fail = async (res) => {
    const data = await res.json().catch(() => ({}));
    const type = typeof data.error === "string" ? data.error : data.error?.type;
    exit(`Airtable respondió ${res.status}${type ? ` (${type})` : ""}`);
  };

  // 3. ¿Ya existe? (el email es una constante, no input de usuario)
  const list = await fetch(`${base}/listRecords`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      returnFieldsByFieldId: true,
      fields: [IDS.email],
      filterByFormula: `LOWER({${IDS.email}}) = "${ADMIN.email}"`,
      maxRecords: 1,
    }),
  });
  if (!list.ok) await fail(list);
  const { records } = await list.json();
  if (records.length > 0) {
    console.log(`✔ Ya existe un usuario con ${ADMIN.email} (${records[0].id}). No se cambió nada.`);
    return;
  }

  // 4. Crear.
  const hash = await hashNewPassword(password);
  const create = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({
      returnFieldsByFieldId: true,
      records: [
        {
          fields: {
            [IDS.nombre]: ADMIN.nombre,
            [IDS.email]: ADMIN.email,
            [IDS.rol]: "Admin",
            [IDS.estado]: "Activo",
            [IDS.sigla]: ADMIN.sigla,
            [IDS.passwordHash]: hash,
            [IDS.debeCambiarPassword]: true,
          },
        },
      ],
    }),
  });
  if (!create.ok) await fail(create);
  const created = await create.json();
  console.log(`✔ Admin creado: ${ADMIN.email} (${created.records[0].id}). Debe cambiar la contraseña al ingresar.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
