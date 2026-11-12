import { describe, expect, it } from "vitest";

import { read, sourceFiles, stripComments } from "./source-files";

/**
 * Convención: todo Route Handler bajo app/api/admin/** llama a requireAdmin()
 * (y está envuelto en apiRoute, para que el guard responda JSON).
 */
const routes = sourceFiles("app/api/admin").filter((f) => /\/route\.(ts|tsx|js|mjs)$/.test(f));

describe("app/api/admin/**", () => {
  it("hay al menos una ruta (el test no pasa vacío)", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(routes)("%s llama a requireAdmin() dentro de apiRoute()", (file) => {
    const code = stripComments(read(file));
    expect(code, `${file} no importa requireAdmin de @/lib/auth/guards`).toMatch(
      /import\s*{[^}]*\brequireAdmin\b[^}]*}\s*from\s*["']@\/lib\/auth\/guards["']/,
    );
    expect(code, `${file} no llama a requireAdmin()`).toMatch(/\brequireAdmin\s*\(/);
    expect(code, `${file} no usa apiRoute()`).toMatch(/\bapiRoute\s*\(/);

    // Cada método HTTP exportado tiene que estar envuelto en apiRoute.
    const methods = [...code.matchAll(/export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)];
    expect(methods.length, `${file} no exporta ningún método`).toBeGreaterThan(0);
    for (const [, method] of methods) {
      expect(code, `${file}: ${method} tiene que ser "export const ${method} = apiRoute(...)"`).toMatch(
        new RegExp(`export\\s+const\\s+${method}\\s*=\\s*apiRoute\\(`),
      );
    }
  });
});
