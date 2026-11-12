import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { HORA_INPUT_KEYS } from "@/lib/horas/rules";
import { deleteHora, updateHora } from "@/lib/horas/server/admin-service";

type Context = { params: Promise<{ id: string }> };

/** PATCH /api/admin/horas/:id · edición. Cargado por no cambia. */
export const PATCH = adminRoute<Context>(async (request, user, { params }) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const { id } = await params;
  return toResponse(await updateHora(user, id, toRawValues(body, HORA_INPUT_KEYS.admin)));
});

/** DELETE /api/admin/horas/:id · borrado físico. */
export const DELETE = adminRoute<Context>(async (_request, _user, { params }) => {
  const { id } = await params;
  return toResponse(await deleteHora(id));
});
