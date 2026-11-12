import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { setUsuarioActivo } from "@/lib/abm/server/usuarios-service";

type Context = { params: Promise<{ id: string }> };

/** POST /api/admin/usuarios/:id/estado · body { activo: boolean }. */
export const POST = adminRoute<Context>(async (request, user, { params }) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const { id } = await params;
  return toResponse(await setUsuarioActivo(user, id, body.activo));
});
