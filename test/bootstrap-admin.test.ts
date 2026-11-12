import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { read, ROOT } from "./source-files";

describe("scripts/bootstrap-admin.mjs", () => {
  it("usa los mismos IDs que lib/airtable/schema.ts", () => {
    const code = read("scripts/bootstrap-admin.mjs");
    const block = /export const IDS = {([\s\S]*?)};/.exec(code)?.[1] ?? "";
    const ids = Object.fromEntries([...block.matchAll(/(\w+):\s*"(\w+)"/g)].map((m) => [m[1], m[2]]));
    const U = TABLES.usuarios.fields;
    expect(ids).toEqual({
      usuarios: TABLES.usuarios.id,
      nombre: U.nombre,
      email: U.email,
      rol: U.rol,
      estado: U.estado,
      sigla: U.sigla,
      passwordHash: U.passwordHash,
      debeCambiarPassword: U.debeCambiarPassword,
    });
  });

  it("nunca imprime la contraseña ni el hash", () => {
    const logs = [...read("scripts/bootstrap-admin.mjs").matchAll(/console\.(log|error)\(([^;]*)\);/g)].map((m) => m[2]);
    for (const line of logs) expect(line).not.toMatch(/\b(password|hash)\b/);
  });
});

/**
 * Corre el script real con una contraseña inválida. Las variables pasadas por
 * env tienen prioridad sobre .env.local (@next/env no las pisa), y el token es
 * falso: si el script llegara a llamar a Airtable, fallaría con otro mensaje.
 */
function runBootstrap(password: string) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/bootstrap-admin.mjs"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        AIRTABLE_TOKEN: "patFAKEFAKEFAKE00.0000",
        AIRTABLE_BASE_ID: "appxGhn6qLbmWvMke",
        BOOTSTRAP_ADMIN_PASSWORD: password,
      },
      timeout: 20_000,
    },
  );
}

describe("bootstrap: rechaza contraseñas fuera de la política (F-01)", () => {
  it("más de 72 bytes → exit 1, mensaje claro, sin imprimir la contraseña", () => {
    const password = "ñ".repeat(37); // 37 caracteres, 74 bytes
    const res = runBootstrap(password);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("BOOTSTRAP_ADMIN_PASSWORD no es válida");
    expect(res.stderr).toContain("72 bytes");
    expect(res.stderr + res.stdout).not.toContain(password);
  });

  it("menos de 10 caracteres → exit 1", () => {
    const res = runBootstrap("corta");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("al menos 10 caracteres");
  });
});
