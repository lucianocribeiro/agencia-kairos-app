import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { LEAD_INPUT_KEYS } from "@/lib/leads/leads";
import { deleteLead, updateLead } from "@/lib/leads/server/service";

type Context = { params: Promise<{ id: string }> };

/** PATCH /api/admin/leads/:id · edición (un lead convertido → 409). */
export const PATCH = adminRoute<Context>(async (request, _user, { params }) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const { id } = await params;
  return toResponse(await updateLead(id, toRawValues(body, LEAD_INPUT_KEYS)));
});

/** DELETE /api/admin/leads/:id · borrado físico del lead (también convertido). Nunca toca al cliente. */
export const DELETE = adminRoute<Context>(async (_request, _user, { params }) => {
  const { id } = await params;
  return toResponse(await deleteLead(id));
});
