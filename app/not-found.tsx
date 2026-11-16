import type { Metadata } from "next";

import { NotFoundPage } from "@/components/shell/not-found-view";

export const metadata: Metadata = { title: "Página no encontrada" };

/** URL desconocida (todos los roles y sin sesión): mensaje neutro y «Volver al inicio». */
export default function NotFound() {
  return <NotFoundPage />;
}
