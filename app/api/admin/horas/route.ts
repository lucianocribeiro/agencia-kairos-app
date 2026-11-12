import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { HORA_INPUT_KEYS } from "@/lib/horas/rules";
import { createHora, listHorasAdmin } from "@/lib/horas/server/admin-service";

/** GET /api/admin/horas?desde&hasta&colaborador&proyecto&cliente · lista filtrada con total. */
export const GET = adminRoute(async (request) => {
  const q = request.nextUrl.searchParams;
  return toResponse(
    await listHorasAdmin({ desde: q.get("desde"), hasta: q.get("hasta"), colaborador: q.get("colaborador"), proyecto: q.get("proyecto"), cliente: q.get("cliente") }),
  );
});

/** POST /api/admin/horas · alta (cualquier fecha, cualquier proyecto). Cargado por = la sesión. */
export const POST = adminRoute(async (request, user) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  return toResponse(await createHora(user, toRawValues(body, HORA_INPUT_KEYS.admin)), 201);
});
