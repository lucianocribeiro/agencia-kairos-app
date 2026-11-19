import { NextResponse } from "next/server";

import { toResponse } from "@/lib/abm/server/http";
import { adminRoute, readJsonBody, REQUEST_MESSAGES } from "@/lib/auth/api";
import { completarRegistro } from "@/lib/factura/server/service";
import { rejectCrossOrigin } from "@/lib/ventas-compras/server/upload";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/facturas/:id/completar · JSON {} · «Completar registro» de una factura
 * Autorizada en Producción: crea lo que falte en Ventas y Horas (idempotente). No-store.
 */
export const POST = adminRoute<Context>(
  async (request, _user, { params }) => {
    const { id } = await params;
    const cross = rejectCrossOrigin(request);
    if (cross) return cross;
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    if (Object.keys(body).length > 0) return NextResponse.json({ error: REQUEST_MESSAGES.formato }, { status: 400 });
    return toResponse(await completarRegistro(id));
  },
  { noStore: true },
);
