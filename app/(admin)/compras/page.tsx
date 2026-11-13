import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { ComprobantesPage } from "@/components/comprobantes/server/comprobantes-page";

/** La página lee la lista en el servidor (mismo límite que la API). */
export const maxDuration = 300;

export const metadata: Metadata = { title: "Compras" };

/** Compras › Comprobantes (solo Admin): lista con filtros, totales, edición y borrado. */
export default function Page() {
  return (
    <Guarded admin>
      <ComprobantesPage kind="compras" />
    </Guarded>
  );
}
