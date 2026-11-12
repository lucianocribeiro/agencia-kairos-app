import { NextResponse, type NextRequest } from "next/server";

import { apiRoute } from "@/lib/auth/api";
import { LOGIN_PATH } from "@/lib/auth/constants";
import { homeFor } from "@/lib/auth/login";
import { clearSessionCookie, getSessionState } from "@/lib/auth/session";

/**
 * GET /api/auth/expirada · Las páginas no pueden borrar cookies: cuando un
 * guard encuentra una sesión inválida redirige acá. Solo borra la cookie si
 * de verdad es inválida (un link externo no puede cerrar una sesión válida).
 */
export const GET = apiRoute(async (request: NextRequest) => {
  const state = await getSessionState();
  if (state.status === "valid") {
    return NextResponse.redirect(new URL(homeFor(state.user), request.url), 303);
  }
  const res = NextResponse.redirect(new URL(LOGIN_PATH, request.url), 303);
  clearSessionCookie(res);
  return res;
});
