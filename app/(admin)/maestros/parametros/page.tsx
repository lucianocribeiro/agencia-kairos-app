import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { MaestroPage } from "@/components/abm/server/maestro-page";

export const metadata: Metadata = { title: "Parámetros" };

export default function Page() {
  return (
    <Guarded admin>
      <MaestroPage slug="parametros" />
    </Guarded>
  );
}
