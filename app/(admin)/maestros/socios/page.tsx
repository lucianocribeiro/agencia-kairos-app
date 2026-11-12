import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const metadata: Metadata = { title: "Socios" };

export default function Page() {
  return (
    <Guarded admin>
      <PlaceholderPage title="Socios" />
    </Guarded>
  );
}
