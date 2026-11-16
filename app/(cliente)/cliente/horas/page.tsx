import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { ClientePage, type SearchParams } from "@/components/cliente/server/cliente-page";

export const metadata: Metadata = { title: "Horas" };

/** Vista del rol Cliente: horas e importes de sus proyectos (solo lectura). */
export default function Page(props: { searchParams?: SearchParams } = {}) {
  return (
    <Guarded cliente>
      <ClientePage searchParams={props.searchParams} />
    </Guarded>
  );
}
