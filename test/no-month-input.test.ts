import { describe, expect, it } from "vitest";

import { read, sourceFiles, stripComments } from "./source-files";

/**
 * CC-F4-07: ningún `<input type="month">` en components/ ni en app/ (los meses son los selects
 * Mes + Año de components/ui/mes-anio-select.tsx), ni su estilo en globals.css.
 */
const FILES = ["components", "app"].flatMap((d) => sourceFiles(d, [".tsx", ".ts"])).filter((f) => !/\.test\.tsx?$/.test(f));

describe("sin input de mes nativo", () => {
  it("hay archivos para revisar", () => expect(FILES.length).toBeGreaterThan(50));

  it.each(FILES)("%s", (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/type=\{?\s*["'`]month["'`]/);
    expect(code).not.toMatch(/type:\s*["'`]month["'`]/);
  });

  it("app/globals.css ya no estiliza input[type=\"month\"]", () => {
    expect(read("app/globals.css")).not.toContain('type="month"');
  });
});
