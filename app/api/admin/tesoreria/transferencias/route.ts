import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { createTransferencia, TRANSFERENCIA_INPUT_KEYS } from "@/lib/tesoreria/server/transferencias";

/** POST /api/admin/tesoreria/transferencias · transferencia entre cuentas propias (2 registros, compensado). */
export const POST = adminRoute(async (request) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  return toResponse(await createTransferencia(toRawValues(body, TRANSFERENCIA_INPUT_KEYS)), 201);
});
