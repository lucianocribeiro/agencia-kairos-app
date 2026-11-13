import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { deleteMovimiento, MOVIMIENTO_INPUT_KEYS, updateMovimiento } from "@/lib/tesoreria/server/movimientos";

type Context = { params: Promise<{ id: string }> };

/** PATCH /api/admin/tesoreria/:id · edita un movimiento (escribe solo lo enviado). Transferencias → 409. */
export const PATCH = adminRoute<Context>(async (request, _user, { params }) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const { id } = await params;
  return toResponse(await updateMovimiento(id, toRawValues(body, MOVIMIENTO_INPUT_KEYS)));
});

/** DELETE /api/admin/tesoreria/:id · borra un movimiento. Transferencias → 409 (se borran de a par). */
export const DELETE = adminRoute<Context>(async (_request, _user, { params }) => {
  const { id } = await params;
  return toResponse(await deleteMovimiento(id));
});
