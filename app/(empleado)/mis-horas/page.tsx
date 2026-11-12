import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const metadata: Metadata = { title: "Mis horas" };

export default function Page() {
  return (
    <Guarded>
      <PlaceholderPage title="Mis horas" />
    </Guarded>
  );
}
