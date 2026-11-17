import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { marcarEstadoSeleccion } from "@/lib/horas/server/seleccion-service";

/**
 * POST /api/admin/horas/seleccion/estado · body { ids: ["rec…"], estado } (hasta 500) → cambia
 * SOLO el Estado de facturación de esas horas (CC-F4-08). Mismas validaciones que la selección;
 * fail-closed con restauración de los valores anteriores.
 */
export const POST = adminRoute(
  async (request) => {
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    return toResponse(await marcarEstadoSeleccion(body));
  },
  { noStore: true },
);
