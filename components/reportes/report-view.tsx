import { Download } from "lucide-react";

import { InlineMessage } from "@/components/ui";
import { buttonClasses } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/control-classes";
import { cn } from "@/lib/cn";
import { REPORTES, type ReporteSlug } from "@/lib/reportes/excel";
import type { Vista } from "@/lib/reportes/vista";

import { Tabla } from "./vista-tabla";


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
