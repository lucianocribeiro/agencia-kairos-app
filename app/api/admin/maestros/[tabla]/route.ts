import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { maestroInputKeys } from "@/lib/abm/maestros";
import { createMaestro } from "@/lib/abm/server/maestros-service";

type Context = { params: Promise<{ tabla: string }> };

/** POST /api/admin/maestros/:tabla · alta. Body: valores del formulario por clave. */
export const POST = adminRoute<Context>(async (request, _user, { params }) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const { tabla } = await params;
  return toResponse(await createMaestro(tabla, toRawValues(body, maestroInputKeys(tabla))), 201);
});
