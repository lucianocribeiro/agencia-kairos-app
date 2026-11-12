import ts from "typescript";

/**
 * Chequeo por AST (TypeScript compiler API) de un archivo de Route Handler.
 * Cada método HTTP exportado tiene que ser exactamente
 *   export const GET = <wrapper>(...)
 * donde <wrapper> es adminRoute o userRoute importado de "@/lib/auth/api".
 * Falla también con `export async function GET`, `export { x as GET }`,
 * `export *` y `export default`.
 */
export const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export type Wrapper = "adminRoute" | "userRoute";

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

export function checkRouteSource(fileName: string, source: string, wrapper: Wrapper): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems: string[] = [];
  const at = (node: ts.Node) => `${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  // Nombre local con el que se importó el wrapper desde @/lib/auth/api.
  let local: string | null = null;
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== "@/lib/auth/api") continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) if ((el.propertyName ?? el.name).text === wrapper) local = el.name.text;
    }
  }

  let exportedMethods = 0;
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(st, ts.SyntaxKind.DefaultKeyword)) problems.push(`${at(st)}: export default no permitido`);
      else if (st.name && HTTP_METHODS.has(st.name.text)) {
        exportedMethods++;
        problems.push(`${at(st)}: ${st.name.text} declarado como función; tiene que ser "export const ${st.name.text} = ${wrapper}(...)"`);
      }
    } else if (ts.isExportAssignment(st)) {
      problems.push(`${at(st)}: export default no permitido`);
    } else if (ts.isExportDeclaration(st)) {
      if (!st.exportClause) problems.push(`${at(st)}: export * no permitido en rutas`);
      else if (ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          if (HTTP_METHODS.has(el.name.text)) {
            exportedMethods++;
            problems.push(`${at(el)}: ${el.name.text} re-exportado; tiene que ser "export const ${el.name.text} = ${wrapper}(...)"`);
          }
        }
      }
    } else if (ts.isVariableStatement(st) && hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
      const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const decl of st.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !HTTP_METHODS.has(decl.name.text)) continue;
        exportedMethods++;
        const name = decl.name.text;
        const init = decl.initializer;
        const wrapped =
          isConst &&
          local !== null &&
          init !== undefined &&
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          init.expression.text === local;
        if (!wrapped) problems.push(`${at(decl)}: ${name} no está envuelto en ${wrapper}() de @/lib/auth/api`);
      }
    }
  }

  if (exportedMethods === 0) problems.push(`${fileName}: no exporta ningún método HTTP`);
  return problems;
}
