import "server-only";

import { connection } from "next/server";

import { InlineMessage } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guards";
import { REPORTES, type ReporteSlug } from "@/lib/reportes/excel";
import { cargarReporte } from "@/lib/reportes/server/service";
import { ReportView } from "../report-view";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Página de un reporte (Admin), con guard propio. Lee y calcula en el servidor en cada request. */
export async function ReportePage({ slug, searchParams }: { slug: ReporteSlug; searchParams?: SearchParams }) {
  await requireAdmin();
  await connection();
  const sp = (await searchParams) ?? {};
  const desde = typeof sp.desde === "string" && sp.desde ? sp.desde : null;
  const res = await cargarReporte(slug, desde);
  if (!res.ok) {
    if (res.status !== 400) throw new Error(res.error);
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{REPORTES[slug].titulo}</h1>
        <InlineMessage tone="danger">{res.error}</InlineMessage>
        <a href={REPORTES[slug].ruta} className="text-sm text-text underline">
          Volver al período por defecto
        </a>
      </div>
    );
  }
  const periodo = "periodo" in res.data.data ? res.data.data.periodo.desde : null;
  return <ReportView slug={slug} vista={res.data.vista} desde={periodo} />;
}
