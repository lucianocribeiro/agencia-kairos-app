import "server-only";

import { connection } from "next/server";

import { HorasManager } from "@/components/horas/horas-manager";
import { requireAdmin } from "@/lib/auth/guards";
import { todayInBuenosAires } from "@/lib/horas/dates";
import { listHorasAdmin, loadHorasOptions } from "@/lib/horas/server/admin-service";

/** Horas (Admin), con guard propio. Por defecto: mes actual, sin filtros. */
export async function HorasPage() {
  await requireAdmin();
  await connection();
  const now = new Date();
  const today = todayInBuenosAires(now);
  const options = await loadHorasOptions();
  const list = await listHorasAdmin({ desde: null, hasta: null, colaborador: null, proyecto: null, cliente: null }, now, options);
  const initial = list.ok ? list.data : { range: { desde: today, hasta: today }, records: [], total: 0 };
  return <HorasManager today={today} options={options} initial={initial} />;
}
