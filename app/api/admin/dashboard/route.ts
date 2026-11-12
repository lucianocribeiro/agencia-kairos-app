import { adminRoute } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { loadDashboard } from "@/lib/horas/server/dashboard-service";

/** GET /api/admin/dashboard?desde&hasta&agrupacion=diaria|semanal|mensual&proyectos=rec1,rec2 · solo horas. */
export const GET = adminRoute(async (request) => {
  const q = request.nextUrl.searchParams;
  const proyectos = (q.get("proyectos") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return toResponse(await loadDashboard({ desde: q.get("desde"), hasta: q.get("hasta"), agrupacion: q.get("agrupacion"), proyectos }));
});
