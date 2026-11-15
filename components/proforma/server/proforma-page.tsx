import "server-only";

import { connection } from "next/server";

import { requireAdmin } from "@/lib/auth/guards";
import { clientesActivos, cargarProforma, validarQuery } from "@/lib/proforma/server/service";
import { ProformaView } from "../proforma-view";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Proforma (Admin), con guard propio. Sin cliente: solo los selectores. */
export async function ProformaPage({ searchParams }: { searchParams?: SearchParams }) {
  await requireAdmin();
  await connection();
  const sp = (await searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : null);
  const q = { cliente: str("cliente"), mes: str("mes") };
  const clientes = await clientesActivos();
  const v = validarQuery(q);
  if ("error" in v) return <ProformaView clientes={clientes} cliente={q.cliente} mes={q.mes ?? ""} data={null} error={v.error} />;
  if (!v.cliente) return <ProformaView clientes={clientes} cliente={null} mes={v.mes} data={null} error={null} />;
  const res = await cargarProforma(q);
  if (!res.ok && res.status >= 500) throw new Error(res.error);
  return <ProformaView clientes={clientes} cliente={v.cliente} mes={v.mes} data={res.ok ? res.data : null} error={res.ok ? null : res.error} />;
}
