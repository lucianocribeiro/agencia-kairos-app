import { describe, expect, it } from "vitest";

import { OLD_OPTIONS } from "../scripts/lib/migrate-clientes-estado.mjs";
import { read, sourceFiles, stripComments } from "./source-files";

/**
 * Las opciones viejas de Clientes › Estado (Cliente, Lead, Ex cliente, Perdido) ya no
 * existen en la base (migración CC-F2-01 + limpieza CC-F2-02). Solo pueden aparecer en el
 * módulo de migración (que se conserva con sus tests). «Cliente» también es una etiqueta
 * de UI, así que para ese literal solo cuenta si está en la misma línea que «estado».
 * «Lead» es además una opción de Leads › Tipo (CC-F4-06): se admite solo en el módulo Leads
 * (lib/leads, components/leads, sus tests) y en el bloque `leads` de schema.ts.
 */
const ALLOWED = new Set(["scripts/lib/migrate-clientes-estado.mjs", "test/legacy-literals.test.ts"]);
const FILES = ["app", "components", "lib", "scripts", "test"].flatMap((d) => sourceFiles(d)).concat(["proxy.ts"]);
const [LEGACY_ACTIVO, ...ONLY_LEGACY] = OLD_OPTIONS as string[];
const quoted = (s: string) => new RegExp(`["'\`]${s}["'\`]`);
const LEAD_TIPO = "Lead";
const isLeadsModule = (file: string) => /^(lib|components)\/leads\//.test(file) || /^test\/leads[.-]/.test(file);
/** schema.ts sin el bloque de la tabla Leads (sus opciones de Tipo incluyen «Lead»). */
const withoutLeadsTable = (source: string) => source.replace(/\n {2}leads: \{[\s\S]*?\n {2}\},/, "\n");

describe("excepción de Leads › Tipo", () => {
  it("el bloque `leads` de schema.ts existe y es el único que se saca", () => {
    const schema = read("lib/airtable/schema.ts");
    expect(schema).toMatch(/\n {2}leads: \{/);
    expect(quoted(LEAD_TIPO).test(stripComments(withoutLeadsTable(schema)))).toBe(false);
  });
});

describe("literales de las opciones viejas de Clientes › Estado", () => {
  it("el módulo de migración conserva las 4 opciones viejas", () => {
    expect(OLD_OPTIONS).toHaveLength(4);
  });

  it.each(FILES.filter((f) => !ALLOWED.has(f)))("%s", (file) => {
    const source = file === "lib/airtable/schema.ts" ? withoutLeadsTable(read(file)) : read(file);
    const lines = stripComments(source).split("\n");
    const hits = lines.flatMap((line, i) => {
      const bad: string[] = ONLY_LEGACY.filter((v) => !(v === LEAD_TIPO && isLeadsModule(file)) && quoted(v).test(line));
      if (quoted(LEGACY_ACTIVO).test(line) && /estado/i.test(line)) bad.push(LEGACY_ACTIVO);
      return bad.map((v) => `${i + 1}: ${v}`);
    });
    expect(hits).toEqual([]);
  });
});
