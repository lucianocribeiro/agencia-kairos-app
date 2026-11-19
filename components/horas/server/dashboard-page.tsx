import "server-only";

import { connection } from "next/server";

import { DashboardView } from "@/components/horas/dashboard-view";
import { requireAdmin } from "@/lib/auth/guards";
import { todayInBuenosAires } from "@/lib/horas/dates";
import { cargarDashboardAdmin } from "@/lib/horas/server/dashboard-admin-service";

/**
 * Dashboard (Admin), con guard propio. Por defecto: mes actual, agrupación mensual, todos los
 * proyectos con horas, todos los clientes y estados. Con importes (CC-F4-11).
 */
export async function DashboardPage() {
  await requireAdmin();
  await connection();
  const now = new Date();
  const res = await cargarDashboardAdmin({ desde: null, hasta: null, agrupacion: "mensual", proyectos: [], cliente: null, estado: null }, now);
  if (!res.ok) throw new Error("No se pudo cargar el dashboard");
  return <DashboardView today={todayInBuenosAires(now)} initial={res.data} />;
}
