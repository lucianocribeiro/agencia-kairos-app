import "server-only";

import { connection } from "next/server";

import { TesoreriaManager, type TesoreriaInicial } from "@/components/tesoreria/tesoreria-manager";
import { requireAdmin } from "@/lib/auth/guards";
import { todayInBuenosAires } from "@/lib/horas/dates";
import { listTesoreria, loadTesoreriaCtx } from "@/lib/tesoreria/server/movimientos";

/** Tesorería (Admin), con guard propio. Por defecto: la primera cuenta (por nombre) y el año actual. */
export async function TesoreriaPage() {
  await requireAdmin();
  await connection();
  const now = new Date();
  const ctx = await loadTesoreriaCtx();
  const cuenta = ctx.cuentas[0]?.id;
  let initial: TesoreriaInicial | null = null;
  if (cuenta) {
    const res = await listTesoreria({ cuenta }, now);
    if (!res.ok) throw new Error(res.error);
    initial = res.data as unknown as TesoreriaInicial;
  }
  return <TesoreriaManager today={todayInBuenosAires(now)} initial={initial} />;
}
