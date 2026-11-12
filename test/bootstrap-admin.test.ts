import { describe, expect, it } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { read } from "./source-files";

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
