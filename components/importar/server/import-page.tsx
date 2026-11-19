import "server-only";

import { connection } from "next/server";

import { ImportManager } from "@/components/importar/import-manager";
import { isArcaConfigured } from "@/lib/arca/server/config";
import { requireAdmin } from "@/lib/auth/guards";
import { todayInBuenosAires } from "@/lib/horas/dates";
import type { Kind } from "@/lib/ventas-compras/columns";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Ventas › Importar / Compras › Importar (Admin), con guard propio. Lee en request time si la
 * sincronización con ARCA está configurada (AFIP_SDK_TOKEN): al navegador solo llega el booleano.
 * `?origen=arca` (link «Sincronizar con ARCA» de la lista) abre el diálogo al entrar.
 */
export async function ImportPage({ kind, searchParams }: { kind: Kind; searchParams: SearchParams }) {
  await requireAdmin();
  await connection();
  const { origen } = await searchParams;
  const configurado = isArcaConfigured();
  return <ImportManager kind={kind} today={todayInBuenosAires()} arca={{ configurado, abrir: origen === "arca" }} />;
}
