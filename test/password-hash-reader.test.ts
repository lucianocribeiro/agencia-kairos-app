import { describe, expect, it } from "vitest";

import { read, sourceFiles, stripComments } from "./source-files";

/**
 * Usuarios.passwordHash solo lo lee lib/auth/credentials.ts.
 * Ningún otro módulo de la app puede referenciar el campo (ni por nombre de
 * propiedad ni por ID). schema.ts lo define; scripts/bootstrap-admin.mjs solo
 * lo escribe al crear el primer Admin (no lo lee).
 */
const FIELD_ID = "fldbKH5lVR1bEpfqV";
const ALLOWED = new Set(["lib/airtable/schema.ts", "lib/auth/credentials.ts"]);

const appFiles = [...sourceFiles("app"), ...sourceFiles("lib"), ...sourceFiles("components"), "proxy.ts"].filter(
  (f) => !/\.test\.tsx?$/.test(f),
);

describe("lector único de passwordHash", () => {
  it("el campo existe en el schema con ese ID", () => {
    expect(read("lib/airtable/schema.ts")).toMatch(new RegExp(`passwordHash:\\s*"${FIELD_ID}"`));
  });

  it("credentials.ts es el único módulo que lo pide", () => {
    const offenders = appFiles.filter((f) => {
      if (ALLOWED.has(f)) return false;
      const code = stripComments(read(f));
      return /\bpasswordHash\b/.test(code) || code.includes(FIELD_ID);
    });
    expect(offenders).toEqual([]);
  });

  it("dentro de credentials.ts, solo readAuthRecords lo incluye en una lectura", () => {
    const code = stripComments(read("lib/auth/credentials.ts"));
    expect(code.match(/getAirtableClient\(\)\.list\b/g)).toHaveLength(1);
    expect(code).toMatch(/async function readAuthRecords[\s\S]*?getAirtableClient\(\)\.list/);
    expect(code).not.toMatch(/export\s+(async\s+)?function\s+readAuthRecords/);
  });

  it("el bootstrap no lee el hash (solo pide el email)", () => {
    const code = stripComments(read("scripts/bootstrap-admin.mjs"));
    expect(code).toMatch(/fields:\s*\[IDS\.email\]/);
  });
});
