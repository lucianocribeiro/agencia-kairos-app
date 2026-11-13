import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { ComprobantesPage } from "@/components/comprobantes/server/comprobantes-page";

export const metadata: Metadata = { title: "Compras" };

/** Compras › Comprobantes (solo Admin): lista con filtros, totales, edición y borrado. */
export default function Page() {
  return (
    <Guarded admin>
      <ComprobantesPage kind="compras" />
    </Guarded>
  );
}
