import { toResponse } from "@/lib/abm/server/http";
import { adminRoute } from "@/lib/auth/api";
import { cargarDashboardAdmin, dashboardAdminXlsx, queryDashboardAdmin } from "@/lib/horas/server/dashboard-admin-service";
import { XLSX_CONTENT_TYPE } from "@/lib/xlsx/write";

export const maxDuration = 300;

/** GET /api/admin/dashboard/excel?… (mismos filtros) · exactamente lo que muestra la pantalla, como .xlsx. */
export const GET = adminRoute(async (request) => {
  const q = request.nextUrl.searchParams;
  const res = await cargarDashboardAdmin(queryDashboardAdmin((k) => q.get(k)));
  if (!res.ok) return toResponse(res);
  const { bytes, filename } = dashboardAdminXlsx(res.data);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": XLSX_CONTENT_TYPE,
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(bytes.length),
    },
  });
}, { noStore: true });
