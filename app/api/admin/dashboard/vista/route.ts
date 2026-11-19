import { toResponse } from "@/lib/abm/server/http";
import { adminRoute } from "@/lib/auth/api";
import { cargarDashboardAdmin, queryDashboardAdmin } from "@/lib/horas/server/dashboard-admin-service";

export const maxDuration = 300;

/**
 * GET /api/admin/dashboard/vista?desde&hasta&agrupacion&proyectos&cliente&estado (CC-F4-11) ·
 * el dashboard del Admin con importes: horas (todas) + importes de las Facturables con el
 * cálculo de la vista Cliente. Solo Admin.
 */
export const GET = adminRoute(async (request) => {
  const q = request.nextUrl.searchParams;
  return toResponse(await cargarDashboardAdmin(queryDashboardAdmin((k) => q.get(k))));
}, { noStore: true });
