import { toResponse } from "@/lib/abm/server/http";
import { clienteRoute } from "@/lib/auth/api";
import { cargarVistaCliente, queryCliente } from "@/lib/cliente/server/service";

export const maxDuration = 300;

/**
 * GET /api/cliente/horas?desde&hasta&agrupacion=diaria|semanal|mensual|anual&proyectos=rec1,rec2
 * Vista Cliente: horas Facturables de SUS proyectos e importes (solo lectura).
 * Un proyecto no asignado → 403 «Este proyecto no está asignado a tu usuario.».
 */
export const GET = clienteRoute(async (request, user) => {
  const q = request.nextUrl.searchParams;
  return toResponse(await cargarVistaCliente(user.id, queryCliente((k) => q.get(k))));
}, { noStore: true });
