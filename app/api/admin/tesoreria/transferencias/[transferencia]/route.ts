import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { deleteTransferencia, TRANSFERENCIA_INPUT_KEYS, updateTransferencia } from "@/lib/tesoreria/server/transferencias";

type Context = { params: Promise<{ transferencia: string }> };

/** PATCH /api/admin/tesoreria/transferencias/:transferencia · edita los 2 registros juntos (compensado). */
export const PATCH = adminRoute<Context>(async (request, _user, { params }) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const { transferencia } = await params;
  return toResponse(await updateTransferencia(transferencia, toRawValues(body, TRANSFERENCIA_INPUT_KEYS)));
});

/** DELETE /api/admin/tesoreria/transferencias/:transferencia · borra el par (compensado). */
export const DELETE = adminRoute<Context>(async (_request, _user, { params }) => {
  const { transferencia } = await params;
  return toResponse(await deleteTransferencia(transferencia));
});
