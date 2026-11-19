import { NextResponse } from "next/server";

import { toResponse } from "@/lib/abm/server/http";
import { getArcaConfig, ARCA_CONFIG_MESSAGES } from "@/lib/arca/server/config";
import { MAX_PAYLOAD_CHARS, PAYLOAD_MESSAGES } from "@/lib/arca/server/payload";
import { confirmSync } from "@/lib/arca/server/sync";
import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { isKind } from "@/lib/ventas-compras/columns";
import { MAX_EDICIONES_BYTES, rejectCrossOrigin } from "@/lib/ventas-compras/server/upload";

type Context = { params: Promise<{ tabla: string }> };

/** Vercel Hobby: 300 s es el máximo. Escribe como la importación del .xlsx. */
export const maxDuration = 300;

/** Payload firmado + ediciones + margen: por debajo del límite de 4,5 MB de Vercel. */
const MAX_BODY_BYTES = MAX_PAYLOAD_CHARS + MAX_EDICIONES_BYTES + 64 * 1024;

/**
 * POST /api/admin/arca/:tabla/confirmar · JSON { syncId, payload, ediciones }. Verifica la
 * firma y los claims y vuelve a correr adaptador + parse + confirmImport, igual que la
 * confirmación del .xlsx (sin estado). Una sincronización ya importada → 409.
 */
export const POST = adminRoute<Context>(
  async (request, user, { params }) => {
    const { tabla } = await params;
    if (!isKind(tabla)) return NextResponse.json({ error: "No encontramos esa importación." }, { status: 404 });
    const cross = rejectCrossOrigin(request);
    if (cross) return cross;
    if (!getArcaConfig()) return NextResponse.json({ error: ARCA_CONFIG_MESSAGES.noConfigurada }, { status: 503 });
    if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return NextResponse.json({ error: PAYLOAD_MESSAGES.muyGrande }, { status: 413 });
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    return toResponse(await confirmSync(tabla, user, body));
  },
  { noStore: true },
);
