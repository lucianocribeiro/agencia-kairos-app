import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { updateUsuario } from "@/lib/abm/server/usuarios-service";

type Context = { params: Promise<{ id: string }> };

/** PATCH /api/admin/usuarios/:id · edición (sin contraseña). */
export const PATCH = adminRoute<Context>(async (request, user, { params }) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const { id } = await params;
  return toResponse(await updateUsuario(user, id, toRawValues(body)));
});
