import { describe, expect, it } from "vitest";

import { checkRouteSource, type Wrapper } from "./route-guard-check";
import { read, sourceFiles } from "./source-files";

/**
 * Convención (AST): todo método exportado en app/api/admin/** es
 * `export const X = adminRoute(...)`, y en app/api/me/** `export const X = userRoute(...)`.
 */
const routesIn = (dir: string) => {
  try {
    return sourceFiles(dir).filter((f) => /\/route\.(ts|tsx|js|mjs)$/.test(f));
  } catch {
    return []; // la carpeta todavía no existe
  }
};
const check = (file: string, wrapper: Wrapper) => checkRouteSource(file, read(file), wrapper);

describe("app/api/admin/** usa adminRoute", () => {
  const routes = routesIn("app/api/admin");
  it("hay al menos una ruta (el test no pasa vacío)", () => expect(routes.length).toBeGreaterThan(0));
  it.each(routes)("%s", (file) => expect(check(file, "adminRoute")).toEqual([]));
});

describe("app/api/me/** usa userRoute", () => {
  const routes = routesIn("app/api/me");
  it.each(routes.length ? routes : ["(sin rutas todavía)"])("%s", (file) => {
    if (file.startsWith("(")) return;
    expect(check(file, "userRoute")).toEqual([]);
  });
});

describe("el chequeo detecta violaciones (fixtures fuera de app/)", () => {
  const F = "test/fixtures/route-guards";

  it("GET protegido + POST sin proteger → falla por el POST", () => {
    const problems = check(`${F}/mixed.ts`, "adminRoute");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/POST no está envuelto en adminRoute/);
  });

  it("`export async function GET` → falla", () => {
    expect(check(`${F}/function-style.ts`, "adminRoute")).toEqual([expect.stringMatching(/GET declarado como función/)]);
  });

  it("re-export y wrapper local falso → falla", () => {
    const problems = check(`${F}/reexport.ts`, "adminRoute");
    expect(problems).toEqual([
      expect.stringMatching(/GET no está envuelto/),
      expect.stringMatching(/DELETE re-exportado/),
    ]);
  });

  it("userRoute en una ruta de admin → falla; adminRoute en una de me → falla", () => {
    expect(check(`${F}/wrong-wrapper.ts`, "adminRoute")).toEqual([expect.stringMatching(/GET no está envuelto en adminRoute/)]);
    expect(check(`${F}/ok.ts`, "userRoute")).toHaveLength(2);
  });

  it("todo envuelto (con alias) → pasa", () => {
    expect(check(`${F}/ok.ts`, "adminRoute")).toEqual([]);
  });

  it("export default / export * / sin métodos → falla", () => {
    expect(checkRouteSource("a.ts", "export default function handler() {}", "adminRoute")).toEqual([
      expect.stringMatching(/export default/),
      expect.stringMatching(/no exporta ningún método/),
    ]);
    expect(checkRouteSource("b.ts", 'export * from "./x";', "adminRoute")[0]).toMatch(/export \*/);
    expect(checkRouteSource("c.ts", 'import { adminRoute } from "@/lib/auth/api";\nexport let GET = adminRoute(async () => new Response());', "adminRoute")[0]).toMatch(
      /GET no está envuelto/,
    );
  });
});
