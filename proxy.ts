import { NextResponse, type NextRequest } from "next/server";

import { LOGIN_PATH, SESSION_COOKIE } from "@/lib/auth/constants";
import { verifySessionToken } from "@/lib/auth/token";

/**
 * Proxy (Next.js 16: reemplaza a middleware.ts). Corre antes de renderizar las páginas.
 *
 * SOLO redirige a /login cuando la cookie falta o su firma es inválida/vencida.
 * No consulta Airtable ni decide permisos: la autorización real está en
 * lib/auth/guards.ts (requireUser / requireAdmin), en cada página y API.
 * Las rutas /api/** no pasan por acá: sus guards responden 401/403 en JSON.
 */

const PUBLIC_PATHS = new Set([LOGIN_PATH]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifySessionToken(token, process.env.SESSION_SECRET) : null;
  if (payload) return NextResponse.next();

  const res = NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  if (token) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  // Todo menos API, assets de Next y archivos con extensión (icon.svg, Logo.png, etc.).
  matcher: ["/((?!api/|_next/static|_next/image|.*\\..*).*)"],
};
