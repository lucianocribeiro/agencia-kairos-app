import "server-only";

import { connection } from "next/server";

import { ComprobantesManager, type ListadoInicial } from "@/components/comprobantes/comprobantes-manager";
import { requireAdmin } from "@/lib/auth/guards";
import { todayInBuenosAires } from "@/lib/horas/dates";
import type { Kind } from "@/lib/ventas-compras/columns";
import { listComprobantes } from "@/lib/ventas-compras/server/comprobantes";

/** Ventas › Comprobantes / Compras › Comprobantes (Admin), con guard propio. Por defecto: año actual. */
export async function ComprobantesPage({ kind }: { kind: Kind }) {
  await requireAdmin();
  await connection();
  const now = new Date();
  const res = await listComprobantes(kind, {}, now);
  if (!res.ok) throw new Error(res.error);
  return <ComprobantesManager kind={kind} today={todayInBuenosAires(now)} initial={res.data as ListadoInicial} />;
}
