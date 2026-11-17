import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { LeadsPage } from "@/components/leads/server/leads-page";

export const metadata: Metadata = { title: "Leads" };

export default function Page() {
  return (
    <Guarded admin>
      <LeadsPage />
    </Guarded>
  );
}
