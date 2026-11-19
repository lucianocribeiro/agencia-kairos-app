import { toResponse } from "@/lib/abm/server/http";
import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { emitirFactura } from "@/lib/factura/server/service";
import { rejectCrossOrigin } from "@/lib/ventas-compras/server/upload";

/** Auth, último número y FECAESolicitar (cada pedido hasta 30 s). */
export const maxDuration = 120;

/**
 * POST /api/admin/facturas/emitir · JSON {cliente, mes, vencimientoPago, detalle} (solo esas
 * claves). Revalida todo en el servidor, crea el comprobante «En proceso» antes de hablar con
 * ARCA y pide el CAE una sola vez (CC-F5-10). Devuelve {id, estado, mensaje}. No-store.
 */
export const POST = adminRoute(
  async (request, user) => {
    const cross = rejectCrossOrigin(request);
    if (cross) return cross;
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    return toResponse(await emitirFactura(user, body));
  },
  { noStore: true },
);
