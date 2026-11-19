import { toResponse } from "@/lib/abm/server/http";
import { adminRoute } from "@/lib/auth/api";
import { cargarEstadoFactura } from "@/lib/factura/server/service";

/**
 * GET /api/admin/facturas?cliente=rec…&mes=AAAA-MM · «Factura ARCA» de la proforma (CC-F5-10):
 * ambiente, elegibilidad con sus motivos, importes de la factura vs. la proforma y los
 * comprobantes emitidos de ese cliente + mes. Solo lee. No-store.
 */
export const GET = adminRoute(
  async (request) => {
    const q = request.nextUrl.searchParams;
    return toResponse(await cargarEstadoFactura(q.get("cliente") ?? "", q.get("mes") ?? ""));
  },
  { noStore: true },
);
