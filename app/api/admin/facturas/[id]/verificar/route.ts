import { NextResponse } from "next/server";

import { toResponse } from "@/lib/abm/server/http";
import { adminRoute, readJsonBody, REQUEST_MESSAGES } from "@/lib/auth/api";
import { verificarComprobante } from "@/lib/factura/server/service";
import { rejectCrossOrigin } from "@/lib/ventas-compras/server/upload";

type Context = { params: Promise<{ id: string }> };

export const maxDuration = 120;

/**
 * POST /api/admin/facturas/:id/verificar · JSON {} · «Verificar en ARCA» de una factura
 * Incierta (CC-F5-10): FECompUltimoAutorizado y FECompConsultar; nunca pide un CAE. No-store.
 */
export const POST = adminRoute<Context>(
  async (request, _user, { params }) => {
    const { id } = await params;
    const cross = rejectCrossOrigin(request);
    if (cross) return cross;
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    if (Object.keys(body).length > 0) return NextResponse.json({ error: REQUEST_MESSAGES.formato }, { status: 400 });
    return toResponse(await verificarComprobante(id));
  },
  { noStore: true },
);
