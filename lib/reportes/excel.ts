/**
 * Vista de un reporte → hoja de Excel (una sola hoja, con las tablas una debajo de la
 * otra, como en pantalla). Importes en pesos (centavos / 100) con formato #,##0.00;
 * porcentajes como decimal con 0.0%. Puro: los bytes los arma lib/xlsx/write.ts.
 */
import type { XlsxSheet, XlsxStyle, XlsxWriteCell } from "@/lib/xlsx/write";
import { kindDe, type ColumnKind, type Vista } from "./vista";

/** Valor de una celda de la vista tal como va al Excel (null = celda vacía). */
export function valorExcel(kind: ColumnKind, v: string | number | null): string | number | null {
  if (v === null || v === "") return null;
  if (typeof v === "string") return v;
  if (kind === "money") return v / 100;
  return v; // pct (decimal), hours, o un número en una columna de texto
}

function styleFor(kind: ColumnKind, v: string | number | null, total: boolean): XlsxStyle {
  if (typeof v !== "number") return total ? "bold" : "text";
  if (kind === "pct") return total ? "pctBold" : "pct";
  return total ? "moneyBold" : "money";
}

export function vistaToSheet(vista: Vista, sheetName: string): XlsxSheet {
  const rows: XlsxWriteCell[][] = [[{ v: vista.titulo, s: "title" }], ...vista.lineas.map((l) => [l]), ...vista.avisos.map((a) => [a]), []];
  if (vista.error) rows.push([{ v: vista.error, s: "bold" }]);
  let ncols = 1;
  vista.tablas.forEach((t, ti) => {
    if (ti > 0) rows.push([]);
    if (t.titulo) rows.push([{ v: t.titulo, s: "bold" }]);
    if (t.error) {
      rows.push([{ v: t.error, s: "bold" }]);
      return;
    }
    rows.push(t.columnas.map((c) => ({ v: c.label, s: "bold" as const })));
    ncols = Math.max(ncols, t.columnas.length);
    for (const f of t.filas) {
      rows.push(
        t.columnas.map((c, i) => {
          const kind = kindDe(c, f);
          const v = valorExcel(kind, f.cells[i] ?? null);
          if (v === null) return null;
          return { v, s: styleFor(kind, v, !!f.total || !!f.seccion) };
        }),
      );
    }
  });
  const first = Math.min(48, Math.max(20, ...vista.tablas.flatMap((t) => t.filas.map((f) => String(f.cells[0] ?? "").length + 2))));
  const widths = [first, ...Array.from({ length: Math.max(0, ncols - 1) }, (_, i) => {
    const labels = vista.tablas.map((t) => t.columnas[i + 1]?.label ?? "");
    const texts = vista.tablas.flatMap((t) => (t.columnas[i + 1]?.kind === "text" ? t.filas.map((f) => String(f.cells[i + 1] ?? "")) : []));
    return Math.min(40, Math.max(14, ...labels.map((l) => l.length + 2), ...texts.map((x) => x.length + 2)));
  })];
  return { name: sheetName, widths, rows };
}

export const REPORTES = {
  resultados: { titulo: "Resultados", archivo: "Resultados", hoja: "Resultados", ruta: "/reportes/resultados" },
  "resultados-por-proyecto": {
    titulo: "Resultados por UN y proyecto",
    archivo: "Resultados_por_proyecto",
    hoja: "Resultados por proyecto",
    ruta: "/reportes/resultados-por-proyecto",
  },
  socios: { titulo: "Socios", archivo: "Socios", hoja: "Socios", ruta: "/reportes/socios" },
  saldos: { titulo: "Saldos", archivo: "Saldos", hoja: "Saldos", ruta: "/reportes/saldos" },
} as const;

export type ReporteSlug = keyof typeof REPORTES;
export const isReporteSlug = (v: unknown): v is ReporteSlug => typeof v === "string" && Object.hasOwn(REPORTES, v);

/** «Resultados_202601.xlsx» (AAAAMM = mes inicial; en Saldos, el mes de la descarga). */
export const nombreArchivo = (slug: ReporteSlug, aaaamm: string) => `${REPORTES[slug].archivo}_${aaaamm}.xlsx`;
