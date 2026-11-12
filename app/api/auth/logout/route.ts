import { NextResponse, type NextRequest } from "next/server";

import { apiRoute, readJsonBody } from "@/lib/auth/api";
import { LOGIN_PATH } from "@/lib/auth/constants";
import { clearSessionCookie } from "@/lib/auth/session";

/**
 * POST /api/auth/logout · exige JSON (415 si no): un formulario HTML de otro sitio
 * no puede cerrar la sesión. Borra la cookie y responde { redirectTo: "/login" };
 * el cliente navega (components/auth/logout-button.tsx).
 */
export const POST = apiRoute(async (request: NextRequest) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const res = NextResponse.json({ redirectTo: LOGIN_PATH });
  clearSessionCookie(res);
  return res;
});
