import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toRawValues, toResponse } from "@/lib/abm/server/http";
import { createMovimiento, listTesoreria, MOVIMIENTO_INPUT_KEYS } from "@/lib/tesoreria/server/movimientos";

/** Vercel Hobby: 300 s es el máximo. La lista lee toda la tabla (saldo) y corta a 5.000 filas en el rango. */
export const maxDuration = 300;

/**
 * GET /api/admin/tesoreria · lista de una cuenta con saldo corrido y totales.
 * Query: cuenta (obligatoria), desde, hasta (sin fechas = año actual), tipo, movimiento, control, pagina.
 */
export const GET = adminRoute(async (request) => {
  const q = request.nextUrl.searchParams;
  const get = (k: string) => q.get(k) || null;
  const pagina = get("pagina");
  return toResponse(
    await listTesoreria({
      cuenta: get("cuenta"),
      desde: get("desde"),
      hasta: get("hasta"),
      tipo: get("tipo"),
      movimiento: get("movimiento"),
      control: get("control"),
      pagina: pagina === null ? null : /^\d{1,6}$/.test(pagina) ? Number(pagina) : -1,
    }),
  );
});

/** POST /api/admin/tesoreria · alta de un movimiento (no transferencias propias). */
export const POST = adminRoute(async (request) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  return toResponse(await createMovimiento(toRawValues(body, MOVIMIENTO_INPUT_KEYS)), 201);
});
