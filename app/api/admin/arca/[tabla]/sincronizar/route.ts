import { NextResponse } from "next/server";

import { toResponse } from "@/lib/abm/server/http";
import { getArcaConfig, ARCA_CONFIG_MESSAGES } from "@/lib/arca/server/config";
import { startSync } from "@/lib/arca/server/sync";
import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { isKind } from "@/lib/ventas-compras/columns";
import { rejectCrossOrigin } from "@/lib/ventas-compras/server/upload";

type Context = { params: Promise<{ tabla: string }> };

/** Valida, crea el log y el job de Afip SDK (un pedido; el create tarda hasta 30 s). */
export const maxDuration = 60;

/**
 * POST /api/admin/arca/:tabla/sincronizar (tabla = ventas | compras) · JSON
 * { desde, hasta, usuario, clave }. Devuelve { syncId }. El usuario y la clave fiscal solo
 * se usan en el pedido a Afip SDK: nunca se guardan, loguean ni devuelven (CC-F5-03).
 */
export const POST = adminRoute<Context>(
  async (request, user, { params }) => {
    const { tabla } = await params;
    if (!isKind(tabla)) return NextResponse.json({ error: "No encontramos esa importación." }, { status: 404 });
    const cross = rejectCrossOrigin(request);
    if (cross) return cross;
    const config = getArcaConfig();
    if (!config) return NextResponse.json({ error: ARCA_CONFIG_MESSAGES.noConfigurada }, { status: 503 });
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    return toResponse(await startSync(tabla, user, body, config));
  },
  { noStore: true },
);
