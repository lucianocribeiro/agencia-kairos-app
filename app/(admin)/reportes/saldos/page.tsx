import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { ReportePage, type SearchParams } from "@/components/reportes/server/reporte-page";

/** El reporte lee Ventas, Compras y Tesorería completas (mismo límite que la API). */
export const maxDuration = 300;

export const metadata: Metadata = { title: "Saldos" };

/** Saldos de cuentas, clientes y proveedores (solo Admin). */
export default function Page(props: { searchParams?: SearchParams } = {}) {
  return (
    <Guarded admin>
      <ReportePage slug="saldos" searchParams={props.searchParams} />
    </Guarded>
  );
}
