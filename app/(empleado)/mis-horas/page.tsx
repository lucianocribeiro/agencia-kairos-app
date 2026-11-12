import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { MisHorasPage } from "@/components/horas/server/mis-horas-page";

export const metadata: Metadata = { title: "Mis horas" };

export default function Page() {
  return (
    <Guarded>
      <MisHorasPage />
    </Guarded>
  );
}
