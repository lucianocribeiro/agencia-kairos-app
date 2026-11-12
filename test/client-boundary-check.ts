import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import ts from "typescript";

import { ROOT } from "./source-files";

/**
 * Grafo de imports (AST) desde archivos "use client": falla si se llega,
 * directa o transitivamente, a código solo de servidor.
 * - Imports `import type` / `export type` (y named imports todos `type`) se ignoran: se borran al compilar.
 * - Se siguen imports estáticos, re-exports, imports de solo efecto e `import("…")` dinámicos.
 * - Paquetes de node_modules no se recorren.
 */
export function isForbidden(file: string): boolean {
  if (file.startsWith("lib/airtable/")) return true;
  if (file === "lib/env.ts") return true;
  if (file.startsWith("lib/auth/") && file !== "lib/auth/password-policy.ts") return true;
  return false;
}

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = join(ROOT, dirname(fromFile), spec);
  else return null; // paquete
  const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => join(base, `index${e}`))];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return relative(ROOT, c);
  return null;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

export function isClientFile(file: string): boolean {
  const sf = parse(file);
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) {
      if (st.expression.text === "use client") return true;
      continue; // otras directivas
    }
    break;
  }
  return false;
}

/** Specifiers de runtime (no type-only) que importa un archivo. */
export function runtimeImports(file: string): string[] {
  const sf = parse(file);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (!clause.name &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!typeOnly) out.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) out.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Recorre el grafo desde `entry`. Devuelve cada cadena entry → … → módulo prohibido. */
export function forbiddenChains(entry: string): string[][] {
  const parent = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  const chains: string[][] = [];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (file !== entry && isForbidden(file)) {
      const chain = [file];
      for (let p = parent.get(file); p; p = parent.get(p)) chain.unshift(p);
      chains.push(chain);
      continue; // no hace falta seguir adentro
    }
    for (const spec of runtimeImports(file)) {
      const target = resolveSpecifier(file, spec);
      if (target && !parent.has(target)) {
        parent.set(target, file);
        queue.push(target);
      }
    }
  }
  return chains;
}
