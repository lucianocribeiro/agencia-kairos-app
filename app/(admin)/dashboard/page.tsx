import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { DashboardPage } from "@/components/horas/server/dashboard-page";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
  return (
    <Guarded admin>
      <DashboardPage />
    </Guarded>
  );
}
