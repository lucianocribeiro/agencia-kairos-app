import { adminRoute } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { deleteCheckMaestro } from "@/lib/abm/server/maestros-service";

type Context = { params: Promise<{ tabla: string; id: string }> };

/**
 * GET /api/admin/maestros/:tabla/:id/referencias · ¿se puede borrar?
 * { blocked: null | "No se puede borrar: tiene …", references: [{ fieldId, count }] }.
 * Es un aviso previo: el DELETE vuelve a leer las referencias antes de borrar.
 */
export const GET = adminRoute<Context>(async (_request, _user, { params }) => {
  const { tabla, id } = await params;
  return toResponse(await deleteCheckMaestro(tabla, id));
});
