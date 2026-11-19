import { describe, expect, it } from "vitest";

import { read, sourceFiles, stripComments } from "./source-files";

/**
 * CC-F4-09: dos sets de tokens con los mismos nombres (@theme = oscuro, `html.light` = claro),
 * y ningún color crudo fuera de esas definiciones.
 */
const CSS = read("app/globals.css");

function block(css: string, selector: RegExp): string {
  const m = selector.exec(css);
  if (!m) throw new Error(`no encontré ${selector}`);
  const start = m.index + m[0].length;
  return css.slice(start, css.indexOf("}", start));
}

function tokens(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, value] of stripComments(body).matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)) {
    if (value.trim() !== "initial") out.set(name, value.trim().toLowerCase());
  }
  return out;
}

const DARK = tokens(block(CSS, /@theme\s*\{/));
const LIGHT = tokens(block(CSS, /html\.light\s*\{/));

describe("tokens claro / oscuro", () => {
  it("los dos sets tienen exactamente los mismos nombres", () => {
    expect([...LIGHT.keys()].sort()).toEqual([...DARK.keys()].sort());
  });

  it("el set oscuro no cambió (los valores de antes de CC-F4-09)", () => {
    expect(Object.fromEntries(DARK)).toMatchObject({
      "--color-bg": "#000000",
      "--color-surface": "#030712",
      "--color-card": "#111827",
      "--color-line": "#1f2937",
      "--color-text": "#d1d5db",
      "--color-muted": "#9ca3af",
      "--color-accent": "#0de8e1",
      "--color-accent-ink": "#000000",
      "--color-danger": "#c27a7a",
      "--color-success": "#7fae8c",
      // Nuevos: en oscuro, idénticos a lo que se usaba (text-white, text-accent).
      "--color-strong": "#ffffff",
      "--color-accent-text": "#0de8e1",
    });
  });

  it("en claro el accent de relleno sigue siendo #0DE8E1 con texto oscuro encima", () => {
    expect(LIGHT.get("--color-accent")).toBe("#0de8e1");
    expect(LIGHT.get("--color-accent-ink")).toBe("#000000");
  });

  it("en oscuro accent-text = accent (el foco y los links accent no cambian en oscuro)", () => {
    expect(DARK.get("--color-accent-text")).toBe(DARK.get("--color-accent"));
    expect(LIGHT.get("--color-accent-text")).toBe("#047572");
  });

  it("globals.css: ningún color hex fuera de los dos bloques de tokens", () => {
    const rest = stripComments(CSS)
      .replace(/@theme\s*\{[^}]*\}/, "")
      .replace(/html\.light\s*\{[^}]*\}/, "");
    expect(rest).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(rest).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|oklab)\(/i);
  });
});

describe("CC-F4-09-FIX: links y foco", () => {
  const css = stripComments(CSS);

  it("`a { color: inherit }` está dentro de @layer base (no sin capa)", () => {
    const base = /@layer\s+base\s*\{\s*a\s*\{\s*color:\s*inherit;\s*\}\s*\}/;
    expect(css).toMatch(base);
    // Fuera de @layer base no queda ninguna regla de color para `a`.
    expect(css.replace(base, "")).not.toMatch(/(^|[\s,}])a\s*\{[^}]*color\s*:/);
  });

  it("el anillo de foco usa accent-text (#047572 en claro, #0DE8E1 en oscuro)", () => {
    expect(block(css, /:focus-visible\s*\{/)).toMatch(/outline:\s*2px solid var\(--color-accent-text\)/);
  });

  it("el borde de foco de Input/Select usa accent-text", () => {
    const control = read("components/ui/control-classes.ts");
    expect(control).toContain("focus-visible:border-accent-text");
    expect(control).not.toMatch(/focus-visible:border-accent(?![-\w])/);
  });
});

/** Salidas que no son pantalla (PDF de la Proforma): tienen su propia paleta fija. */
const OUTPUTS = new Set(["lib/proforma/pdf.ts"]);
const FILES = ["app", "components", "lib"]
  .flatMap((d) => sourceFiles(d, [".ts", ".tsx"]))
  .filter((f) => !/\.test\.tsx?$/.test(f) && !OUTPUTS.has(f));

describe("componentes: solo tokens, nunca colores crudos", () => {
  it("hay archivos para revisar", () => expect(FILES.length).toBeGreaterThan(100));

  it.each(FILES)("%s", (file) => {
    const code = stripComments(read(file));
    // Hex (#0de8e1, #fff), también como clase arbitraria (bg-[#…]).
    expect(code).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![-\w])|#[0-9a-fA-F]{8}\b/);
    expect(code).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|oklab)\(/);
    // `text-white` / `stroke-white` desaparecen en claro: usar `text-strong`.
    expect(code).not.toMatch(/\b(text|stroke|fill|border|divide)-white\b/);
    // Accent como texto: `text-accent-text` (AA en claro); `text-accent` solo pasa en oscuro.
    expect(code).not.toMatch(/\btext-accent(?![-\w])/);
  });
});
