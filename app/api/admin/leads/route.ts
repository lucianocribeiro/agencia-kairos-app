import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { LEAD_INPUT_KEYS } from "@/lib/leads/leads";
import { createLead } from "@/lib/leads/server/service";

/** POST /api/admin/leads · alta. Body: los 14 campos del formulario por clave (nunca Cliente). */
export const POST = adminRoute(async (request) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  return toResponse(await createLead(toRawValues(body, LEAD_INPUT_KEYS)), 201);
});
