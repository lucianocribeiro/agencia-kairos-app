import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { convertLead } from "@/lib/leads/server/service";

type Context = { params: Promise<{ id: string }> };

/** POST /api/admin/leads/:id/convertir · «Pasar a cliente». Body: { sigla }. */
export const POST = adminRoute<Context>(async (request, _user, { params }) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const { id } = await params;
  return toResponse(await convertLead(id, toRawValues(body, ["sigla"])), 201);
});
