import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { maestroInputKeys } from "@/lib/abm/maestros";
import { deleteMaestro, updateMaestro } from "@/lib/abm/server/maestros-service";

type Context = { params: Promise<{ tabla: string; id: string }> };

/** PATCH /api/admin/maestros/:tabla/:id · edición. */
export const PATCH = adminRoute<Context>(async (request, _user, { params }) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const { tabla, id } = await params;
  return toResponse(await updateMaestro(tabla, id, toRawValues(body, maestroInputKeys(tabla))));
});

/** DELETE /api/admin/maestros/:tabla/:id · borra solo si el maestro lo permite y no tiene referencias (409). */
export const DELETE = adminRoute<Context>(async (_request, _user, { params }) => {
  const { tabla, id } = await params;
  return toResponse(await deleteMaestro(tabla, id));
});
