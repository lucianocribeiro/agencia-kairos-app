import { toResponse } from "@/lib/abm/server/http";
import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { consultarPadron } from "@/lib/padron/server/padron";
import { rejectCrossOrigin } from "@/lib/ventas-compras/server/upload";

/** Auth + getPersona_v2 (cada pedido hasta 30 s, lecturas con reintentos). */
export const maxDuration = 120;

/**
 * POST /api/admin/clientes/padron · JSON {cuit} (solo esa clave). Consulta el padrón de ARCA
 * (getPersona_v2, ambiente prod) y devuelve {razonSocial, domicilio, condicionIva, avisos}.
 * Nunca escribe en Airtable: el formulario completa los campos y el Admin decide si guarda
 * (F5-05 · CC-F5-18). No-store.
 */
export const POST = adminRoute(
  async (request) => {
    const cross = rejectCrossOrigin(request);
    if (cross) return cross;
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    return toResponse(await consultarPadron(body));
  },
  { noStore: true },
);
