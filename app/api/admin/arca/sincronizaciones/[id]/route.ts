import { NextResponse } from "next/server";

import { toResponse } from "@/lib/abm/server/http";
import { getArcaConfig, ARCA_CONFIG_MESSAGES } from "@/lib/arca/server/config";
import { pollSync } from "@/lib/arca/server/sync";
import { adminRoute } from "@/lib/auth/api";
import { rejectCrossOrigin } from "@/lib/ventas-compras/server/upload";

type Context = { params: Promise<{ id: string }> };

/** Un GET del job y, si terminó, la vista previa (lectura de la base como el .xlsx). */
export const maxDuration = 300;

/**
 * GET /api/admin/arca/sincronizaciones/:id · consulta el job una vez. En proceso →
 * { estado: "en_proceso" } (el navegador vuelve a consultar en 5 s). Listo → { estado:
 * "lista", preview, payload } (la misma vista previa que el .xlsx, con el payload firmado).
 */
export const GET = adminRoute<Context>(
  async (request, user, { params }) => {
    const { id } = await params;
    const cross = rejectCrossOrigin(request);
    if (cross) return cross;
    const config = getArcaConfig();
    if (!config) return NextResponse.json({ error: ARCA_CONFIG_MESSAGES.noConfigurada }, { status: 503 });
    return toResponse(await pollSync(id, user, config));
  },
  { noStore: true },
);
