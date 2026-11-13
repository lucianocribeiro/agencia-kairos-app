import { describe, expect, it } from "vitest";

import { OLD_OPTIONS } from "../scripts/lib/migrate-clientes-estado.mjs";
import { read, sourceFiles, stripComments } from "./source-files";

/**
 * Las opciones viejas de Clientes › Estado (Cliente, Lead, Ex cliente, Perdido) ya no
 * existen en la base (migración CC-F2-01 + limpieza CC-F2-02). Solo pueden aparecer en el
 * módulo de migración (que se conserva con sus tests). «Cliente» también es una etiqueta
 * de UI, así que para ese literal solo cuenta si está en la misma línea que «estado».
 */
const ALLOWED = new Set(["scripts/lib/migrate-clientes-estado.mjs", "test/legacy-literals.test.ts"]);
const FILES = ["app", "components", "lib", "scripts", "test"].flatMap((d) => sourceFiles(d)).concat(["proxy.ts"]);
const [LEGACY_ACTIVO, ...ONLY_LEGACY] = OLD_OPTIONS as string[];
const quoted = (s: string) => new RegExp(`["'\`]${s}["'\`]`);

describe("literales de las opciones viejas de Clientes › Estado", () => {
  it("el módulo de migración conserva las 4 opciones viejas", () => {
    expect(OLD_OPTIONS).toHaveLength(4);
  });

  it.each(FILES.filter((f) => !ALLOWED.has(f)))("%s", (file) => {
    const lines = stripComments(read(file)).split("\n");
    const hits = lines.flatMap((line, i) => {
      const bad: string[] = ONLY_LEGACY.filter((v) => quoted(v).test(line));
      if (quoted(LEGACY_ACTIVO).test(line) && /estado/i.test(line)) bad.push(LEGACY_ACTIVO);
      return bad.map((v) => `${i + 1}: ${v}`);
    });
    expect(hits).toEqual([]);
  });
});
