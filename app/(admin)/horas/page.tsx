import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { HorasPage } from "@/components/horas/server/horas-page";

export const metadata: Metadata = { title: "Horas" };

export default function Page() {
  return (
    <Guarded admin>
      <HorasPage />
    </Guarded>
  );
}
