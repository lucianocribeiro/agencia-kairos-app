import { describe, expect, it } from "vitest";

import { LEGACY_CLIENTE_ACTIVO, LEGACY_CLIENTE_ESTADOS } from "@/lib/abm/cliente-estado";
import { OLD_OPTIONS } from "../scripts/lib/migrate-clientes-estado.mjs";
import { read, sourceFiles, stripComments } from "./source-files";

/**
 * F2-01 v2 (fix 4): los valores viejos de Clientes › Estado solo pueden aparecer en el
 * helper de compatibilidad y en el módulo de migración. Los tests los importan de ahí.
 * «Cliente» también es una etiqueta de UI («Cliente», columna, campo de Proyectos), así
 * que para ese literal solo cuenta si está en la misma línea que «estado».
 */
const ALLOWED = new Set(["lib/abm/cliente-estado.ts", "scripts/lib/migrate-clientes-estado.mjs", "test/legacy-literals.test.ts"]);
const FILES = ["app", "components", "lib", "scripts", "test", "proxy.ts"].flatMap((d) => (d.endsWith(".ts") ? [d] : sourceFiles(d)));
const ONLY_LEGACY = LEGACY_CLIENTE_ESTADOS.filter((e) => e !== LEGACY_CLIENTE_ACTIVO);
const quoted = (s: string) => new RegExp(`["'\`]${s}["'\`]`);

describe("literales legacy de Clientes › Estado", () => {
  it("los dos módulos tienen las mismas opciones viejas", () => {
    expect([...OLD_OPTIONS]).toEqual([...LEGACY_CLIENTE_ESTADOS]);
  });

  it.each(FILES.filter((f) => !ALLOWED.has(f)))("%s", (file) => {
    const lines = stripComments(read(file)).split("\n");
    const hits = lines.flatMap((line, i) => {
      const bad: string[] = ONLY_LEGACY.filter((v) => quoted(v).test(line));
      if (quoted(LEGACY_CLIENTE_ACTIVO).test(line) && /estado/i.test(line)) bad.push(LEGACY_CLIENTE_ACTIVO);
      return bad.map((v) => `${i + 1}: ${v}`);
    });
    expect(hits).toEqual([]);
  });
});
