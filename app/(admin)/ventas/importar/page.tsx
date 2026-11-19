import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { ImportPage } from "@/components/importar/server/import-page";

export const metadata: Metadata = { title: "Importar ventas" };

/** Ventas › Importar (solo Admin): .xlsx de ARCA o «Sincronizar con ARCA» → vista previa → confirmar. */
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Guarded admin>
      <ImportPage kind="ventas" searchParams={searchParams} />
    </Guarded>
  );
}
