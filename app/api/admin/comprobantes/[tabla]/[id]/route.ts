import { NextResponse } from "next/server";

import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { isKind } from "@/lib/ventas-compras/columns";
import { COMPROBANTE_INPUT_KEYS, deleteComprobante, updateComprobante } from "@/lib/ventas-compras/server/comprobantes";

type Context = { params: Promise<{ tabla: string; id: string }> };

const notFound = () => NextResponse.json({ error: "No encontramos esa lista." }, { status: 404 });

/** PATCH /api/admin/comprobantes/:tabla/:id · edita solo los campos editables (allowlist). */
export const PATCH = adminRoute<Context>(async (request, _user, { params }) => {
  const { tabla, id } = await params;
  if (!isKind(tabla)) return notFound();
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  return toResponse(await updateComprobante(tabla, id, toRawValues(body, COMPROBANTE_INPUT_KEYS[tabla])));
});

/** DELETE /api/admin/comprobantes/:tabla/:id · borra un comprobante (el proveedor queda). */
export const DELETE = adminRoute<Context>(async (_request, _user, { params }) => {
  const { tabla, id } = await params;
  if (!isKind(tabla)) return notFound();
  return toResponse(await deleteComprobante(tabla, id));
});
