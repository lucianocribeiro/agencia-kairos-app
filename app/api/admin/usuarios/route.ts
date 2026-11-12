import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { createUsuario } from "@/lib/abm/server/usuarios-service";
import { USUARIO_INPUT_KEYS } from "@/lib/abm/usuarios";

/** POST /api/admin/usuarios · alta con contraseña temporal. La respuesta nunca incluye el hash ni la contraseña. */
export const POST = adminRoute(async (request) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  return toResponse(await createUsuario(toRawValues(body, USUARIO_INPUT_KEYS.create)), 201);
});
