import { adminRoute } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { cargarProforma } from "@/lib/proforma/server/service";

/**
 * GET /api/admin/proforma?cliente=rec…&mes=AAAA-MM · proforma de horas (solo lectura).
 * Sin mes = mes actual (Buenos Aires). Toda respuesta: no-store.
 */
export const GET = adminRoute(
  async (request) => {
    const q = request.nextUrl.searchParams;
    return toResponse(await cargarProforma({ cliente: q.get("cliente"), mes: q.get("mes") }));
  },
  { noStore: true },
);
