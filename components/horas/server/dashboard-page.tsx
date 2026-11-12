import "server-only";

import { connection } from "next/server";

import { DashboardView } from "@/components/horas/dashboard-view";
import { requireAdmin } from "@/lib/auth/guards";
import { todayInBuenosAires } from "@/lib/horas/dates";
import { loadDashboard } from "@/lib/horas/server/dashboard-service";

/** Dashboard (Admin), con guard propio. Por defecto: mes actual, agrupación mensual, todos los proyectos con horas. */
export async function DashboardPage() {
  await requireAdmin();
  await connection();
  const now = new Date();
  const res = await loadDashboard({ desde: null, hasta: null, agrupacion: "mensual", proyectos: [] }, now);
  if (!res.ok) throw new Error("No se pudo cargar el dashboard");
  return <DashboardView today={todayInBuenosAires(now)} initial={res.data} />;
}
