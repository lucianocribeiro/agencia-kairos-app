import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { TesoreriaPage } from "@/components/tesoreria/server/tesoreria-page";

/** La página lee la lista en el servidor (mismo límite que la API). */
export const maxDuration = 300;

export const metadata: Metadata = { title: "Tesorería" };

/** Tesorería (solo Admin): saldo por cuenta, movimientos y transferencias propias. */
export default function Page() {
  return (
    <Guarded admin>
      <TesoreriaPage />
    </Guarded>
  );
}
