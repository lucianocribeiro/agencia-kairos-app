import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { cargarSeleccion } from "@/lib/horas/server/seleccion-service";

/**
 * POST /api/admin/horas/seleccion · body { ids: ["rec…"] } (hasta 500) → importe a facturar
 * de esas horas con las reglas de la Proforma. Se releen de Airtable; no se guarda nada.
 */
export const POST = adminRoute(
  async (request) => {
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    return toResponse(await cargarSeleccion(body));
  },
  { noStore: true },
);
