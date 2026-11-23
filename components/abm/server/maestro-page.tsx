import "server-only";

import { MaestroManager } from "@/components/abm/maestro-manager";
import type { MaestroSlug } from "@/lib/abm/maestros";
import { loadMaestro } from "@/lib/abm/server/maestros-service";
import { requireAdmin } from "@/lib/auth/guards";
import { getPadronStatus } from "@/lib/padron/server/padron";

/** Carga los datos de un Maestro (con guard propio, estilo DAL) y monta el ABM. */
export async function MaestroPage({ slug }: { slug: MaestroSlug }) {
  await requireAdmin();
  // Clientes: «Traer datos de ARCA» (F5-05). Al navegador llega solo {configured, motivo}.
  const [data, padron] = await Promise.all([loadMaestro(slug), slug === "clientes" ? getPadronStatus() : Promise.resolve(undefined)]);
  return <MaestroManager slug={slug} data={data} padron={padron} />;
}
