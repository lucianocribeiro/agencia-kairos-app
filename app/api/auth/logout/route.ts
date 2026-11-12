import { NextResponse, type NextRequest } from "next/server";

import { apiRoute } from "@/lib/auth/api";
import { LOGIN_PATH } from "@/lib/auth/constants";
import { clearSessionCookie } from "@/lib/auth/session";

/** POST /api/auth/logout · borra la cookie y redirige a /login (303: el navegador hace GET). */
export const POST = apiRoute(async (request: NextRequest) => {
  const res = NextResponse.redirect(new URL(LOGIN_PATH, request.url), 303);
  clearSessionCookie(res);
  return res;
});
