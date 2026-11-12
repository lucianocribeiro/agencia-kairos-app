#!/usr/bin/env node
/**
 * Crea el primer Admin si no existe. Uso local únicamente: npm run bootstrap:admin
 *
 * Lee .env.local (AIRTABLE_TOKEN, AIRTABLE_BASE_ID, BOOTSTRAP_ADMIN_PASSWORD).
 * BOOTSTRAP_ADMIN_PASSWORD nunca se configura en Vercel.
 * Si ya hay un usuario con ese email (sin distinguir mayúsculas), no cambia nada.
 * Nunca imprime la contraseña ni el hash.
 *
 * Los IDs están copiados de lib/airtable/schema.ts (un .mjs no puede importar
 * ese módulo TypeScript server-only); scripts/bootstrap-admin.test.ts verifica
 * que coincidan.
 */
import process from "node:process";

import nextEnv from "@next/env";
import bcrypt from "bcryptjs";

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

const ADMIN = {
  nombre: "Luciano Ribeiro",
  email: "luciano@agenciakairos.net",
  sigla: "LR",
};
const BCRYPT_COST = 12;

async function main() {
  const { AIRTABLE_TOKEN: token, AIRTABLE_BASE_ID: baseId, BOOTSTRAP_ADMIN_PASSWORD: password } = process.env;
  const missing = ["AIRTABLE_TOKEN", "AIRTABLE_BASE_ID", "BOOTSTRAP_ADMIN_PASSWORD"].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`✖ Faltan en .env.local: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("✖ BOOTSTRAP_ADMIN_PASSWORD tiene que tener al menos 10 caracteres.");
    process.exit(1);
  }

  const base = `https://api.airtable.com/v0/${baseId}/${IDS.usuarios}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const fail = async (res) => {
    const data = await res.json().catch(() => ({}));
    const type = typeof data.error === "string" ? data.error : data.error?.type;
    console.error(`✖ Airtable respondió ${res.status}${type ? ` (${type})` : ""}`);
    process.exit(1);
  };

  // ¿Ya existe? (el email es una constante, no input de usuario)
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

  const hash = await bcrypt.hash(password, BCRYPT_COST);
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
