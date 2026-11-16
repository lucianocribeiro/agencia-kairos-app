import "server-only";

import { connection } from "next/server";

import { requireCliente } from "@/lib/auth/guards";
import { cargarVistaCliente, queryCliente } from "@/lib/cliente/server/service";
import { todayInBuenosAires } from "@/lib/horas/dates";
import { ClienteHorasView } from "../cliente-horas-view";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Vista Cliente, con guard propio. Lee los filtros de la URL (link guardado). Nunca una
 * página de error por un filtro: un proyecto no asignado (403) o un filtro inválido (400)
 * muestran el aviso y la vista de todos sus proyectos asignados.
 */
export async function ClientePage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireCliente();
  await connection();
  const now = new Date();
  const sp = (await searchParams) ?? {};
  const query = queryCliente((k) => (typeof sp[k] === "string" ? (sp[k] as string) : null));

  let res = await cargarVistaCliente(user.id, query, now);
  let aviso: string | null = null;
  if (!res.ok && (res.status === 403 || res.status === 400)) {
    aviso = res.error;
    res = await cargarVistaCliente(user.id, res.status === 403 ? { ...query, proyectos: [] } : { desde: null, hasta: null, agrupacion: null, proyectos: [] }, now);
  }
  if (!res.ok) throw new Error("No se pudo cargar la vista Cliente");
  return <ClienteHorasView today={todayInBuenosAires(now)} initial={res.data} aviso={aviso} />;
}
