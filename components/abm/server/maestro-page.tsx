import "server-only";

import { MaestroManager } from "@/components/abm/maestro-manager";
import type { MaestroSlug } from "@/lib/abm/maestros";
import { loadMaestro } from "@/lib/abm/server/maestros-service";
import { requireAdmin } from "@/lib/auth/guards";

/** Carga los datos de un Maestro (con guard propio, estilo DAL) y monta el ABM. */
export async function MaestroPage({ slug }: { slug: MaestroSlug }) {
  await requireAdmin();
  const data = await loadMaestro(slug);
  return <MaestroManager slug={slug} data={data} />;
}
