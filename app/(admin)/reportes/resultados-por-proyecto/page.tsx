import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { ReportePage, type SearchParams } from "@/components/reportes/server/reporte-page";

/** El reporte lee Ventas, Compras y Tesorería completas (mismo límite que la API). */
export const maxDuration = 300;

export const metadata: Metadata = { title: "Resultados por UN y proyecto" };

/** Resultados por unidad de negocio y por proyecto (solo Admin). */
export default function Page(props: { searchParams?: SearchParams } = {}) {
  return (
    <Guarded admin>
      <ReportePage slug="resultados-por-proyecto" searchParams={props.searchParams} />
    </Guarded>
  );
}
