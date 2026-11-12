import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const ROOT = join(import.meta.dirname, "..");

/** Archivos fuente (relativos a la raíz) bajo `dir`, filtrados por extensión. */
export function sourceFiles(dir: string, exts = [".ts", ".tsx", ".mjs", ".js"]): string[] {
  const abs = join(ROOT, dir);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name === ".next") continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (exts.some((e) => name.endsWith(e))) out.push(relative(ROOT, p));
    }
  };
  walk(abs);
  return out.sort();
}

export const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** Código sin comentarios (para no contar menciones en docs). */
export function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
