import { Download } from "lucide-react";

import { InlineMessage } from "@/components/ui";
import { buttonClasses } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/control-classes";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { formatHours } from "@/lib/horas/time";
import { REPORTES, type ReporteSlug } from "@/lib/reportes/excel";
import { kindDe, type ColumnKind, type Vista, type VistaTabla } from "@/lib/reportes/vista";

/** Valor de una celda en pantalla (es-AR; negativos con signo menos, sin color). */
export function mostrar(kind: ColumnKind, v: string | number | null): string {
  if (v === null || v === "") return "";
  if (typeof v === "string") return v;
  if (kind === "money") return formatNumber(v / 100, { decimals: 2 });
  if (kind === "pct") return `${formatNumber(v * 100, { decimals: 1 })} %`;
  if (kind === "hours") return formatHours(v);
  return String(v);
}

function Tabla({ tabla }: { tabla: VistaTabla }) {
  return (
    <section className="flex flex-col gap-2">
      {tabla.titulo && <h2 className="text-lg font-semibold text-white">{tabla.titulo}</h2>}
      {tabla.error ? (
        <InlineMessage tone="danger">{tabla.error}</InlineMessage>
      ) : (
        <div className="w-full overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                {tabla.columnas.map((c, i) => (
                  <th key={i} scope="col" className={cn("whitespace-nowrap px-4 py-3 font-medium", c.kind !== "text" && "text-right", i === 0 && "sticky left-0 z-10 bg-surface")}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-card">
              {tabla.filas.map((f, r) => (
                <tr key={r} className={cn(f.total && "bg-surface font-semibold text-white", f.seccion && "text-xs uppercase tracking-wide text-muted")}>
                  {tabla.columnas.map((c, i) => {
                    const kind = kindDe(c, f);
                    const first = i === 0;
                    return (
                      <td
                        key={i}
                        className={cn("whitespace-nowrap px-4 py-2", kind !== "text" && "text-right tabular-nums", first && cn("sticky left-0 z-10", f.total ? "bg-surface" : "bg-card"))}
                      >
                        {f.seccion && !first ? "" : mostrar(kind, f.cells[i] ?? null)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Un reporte: título, período (con selector de mes), descarga Excel y tablas. Sin estado de cliente. */
export function ReportView({ slug, vista, desde }: { slug: ReporteSlug; vista: Vista; desde: string | null }) {
  const ruta = REPORTES[slug].ruta;
  const excel = `/api/admin/reportes/${slug}/excel${desde ? `?desde=${desde}` : ""}`;
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{vista.titulo}</h1>
          {vista.lineas.map((l) => (
            <p key={l} className="text-sm text-muted">
              {l}
            </p>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {desde && (
            <form method="get" action={ruta} className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-sm text-text">
                Mes inicial
                <input type="month" name="desde" defaultValue={desde} required className={cn(controlClasses, "w-44")} />
              </label>
              <button type="submit" className={buttonClasses("secondary", "md")}>
                Ver
              </button>
            </form>
          )}
          <a href={excel} className={buttonClasses("primary", "md", "gap-2")} download>
            <Download aria-hidden="true" className="size-4" />
            Descargar Excel
          </a>
        </div>
      </div>
      {vista.avisos.map((a) => (
        <InlineMessage key={a} tone="info">
          {a}
        </InlineMessage>
      ))}
      {vista.error && <InlineMessage tone="danger">{vista.error}</InlineMessage>}
      {vista.tablas.map((t, i) => (
        <Tabla key={i} tabla={t} />
      ))}
    </div>
  );
}
