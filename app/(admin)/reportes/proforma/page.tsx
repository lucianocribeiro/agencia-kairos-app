import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { ProformaPage, type SearchParams } from "@/components/proforma/server/proforma-page";

export const metadata: Metadata = { title: "Proforma de horas" };

/** Proforma de horas de un cliente y un mes (solo Admin; no escribe nada). */
export default function Page(props: { searchParams?: SearchParams } = {}) {
  return (
    <Guarded admin>
      <ProformaPage searchParams={props.searchParams} />
    </Guarded>
  );
}
