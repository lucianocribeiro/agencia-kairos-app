import { NextResponse, type NextRequest } from "next/server";

import { apiRoute, withNoStore } from "@/lib/auth/api";
import { NO_JS_DESTINOS, type NoJsDestino } from "@/lib/no-js-form";

/**
 * POST /api/auth/sin-js?volver=<destino> · destino de los formularios con contraseña cuando el
 * navegador los envía de forma nativa (antes de hidratar o sin JavaScript; CC-F4-10).
 * NUNCA lee el body (ni lo loguea ni lo devuelve), no intenta ningún login ni cambio de
 * contraseña y responde 303 a la página de origen, sin query. Destino desconocido → /login.
 * Solo POST: un GET responde 405.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  await request.body?.cancel().catch(() => {});
  const volver = request.nextUrl.searchParams.get("volver");
  const path = volver && Object.hasOwn(NO_JS_DESTINOS, volver) ? NO_JS_DESTINOS[volver as NoJsDestino] : NO_JS_DESTINOS.login;
  return withNoStore(NextResponse.redirect(new URL(path, request.nextUrl.origin), 303));
});
