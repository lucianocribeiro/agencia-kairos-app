import "server-only";

import { connection } from "next/server";

import { MisHorasManager } from "@/components/horas/mis-horas-manager";
import { requireUser } from "@/lib/auth/guards";
import { todayInBuenosAires } from "@/lib/horas/dates";
import { listMisHoras, loadMisProyectos } from "@/lib/horas/server/me-service";
import type { MisHorasData } from "@/lib/horas/types";

/**
 * Datos de Mis horas para el usuario de la sesión. Lo que se pasa al cliente
 * (y por lo tanto al HTML y al payload RSC) son solo DTOs: test/mis-horas-exposure.test.ts.
 */
export async function loadMisHorasPageProps(userId: string, now = new Date()) {
  const today = todayInBuenosAires(now);
  const [mis, list] = await Promise.all([loadMisProyectos(userId), listMisHoras(userId, { desde: null, hasta: null, proyecto: null }, now)]);
  const initial: MisHorasData = list.ok ? list.data : { range: { desde: today, hasta: today }, records: [], total: 0 };
  return { today, proyectos: mis.activos, filtros: mis.asignados, initial };
}

export async function MisHorasPage() {
  const user = await requireUser();
  await connection(); // "hoy" se calcula en cada request
  return <MisHorasManager {...await loadMisHorasPageProps(user.id)} />;
}
