import "server-only";

import { LeadsManager } from "@/components/leads/leads-manager";
import { requireAdmin } from "@/lib/auth/guards";
import { listLeads } from "@/lib/leads/server/service";

/** Carga los leads (con guard propio, estilo DAL) y monta el ABM. */
export async function LeadsPage() {
  await requireAdmin();
  return <LeadsManager leads={await listLeads()} />;
}
