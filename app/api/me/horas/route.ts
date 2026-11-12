import { readJsonBody, userRoute } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { HORA_INPUT_KEYS } from "@/lib/horas/rules";
import { createMiHora, listMisHoras } from "@/lib/horas/server/me-service";

/**
 * Mis horas (Empleado). Solo GET y POST: un Empleado no edita ni borra
 * (no hay /api/me/horas/[id]; lo verifica test/me-routes.test.ts).
 */

/** GET /api/me/horas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&proyecto=rec… · solo registros propios. */
export const GET = userRoute(async (request, user) => {
  const q = request.nextUrl.searchParams;
  return toResponse(await listMisHoras(user.id, { desde: q.get("desde"), hasta: q.get("hasta"), proyecto: q.get("proyecto") }));
});

/** POST /api/me/horas · body { fecha, proyecto, tarea, desde, hasta }. Colaborador = Cargado por = la sesión. */
export const POST = userRoute(async (request, user) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  return toResponse(await createMiHora(user.id, toRawValues(body, HORA_INPUT_KEYS.empleado)), 201);
});
