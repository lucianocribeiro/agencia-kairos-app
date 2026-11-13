import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { ImportManager } from "@/components/importar/import-manager";

export const metadata: Metadata = { title: "Importar ventas" };

/** Ventas › Importar (solo Admin): .xlsx de ARCA → vista previa → confirmar. */
export default function Page() {
  return (
    <Guarded admin>
      <ImportManager kind="ventas" />
    </Guarded>
  );
}
