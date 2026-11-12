import { NextResponse, type NextRequest } from "next/server";

import { apiRoute, readJsonBody } from "@/lib/auth/api";
import { attemptLogin, clientIp } from "@/lib/auth/login";
import { setSessionCookie } from "@/lib/auth/session";

/** POST /api/auth/login · body JSON { email, password, robot } → { redirectTo } + cookie. 415 si no es JSON. */
export const POST = apiRoute(async (request: NextRequest) => {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const result = await attemptLogin({
    email: body.email,
    password: body.password,
    robot: body.robot,
    ip: clientIp(request.headers),
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const res = NextResponse.json({ redirectTo: result.redirectTo });
  await setSessionCookie(res, { userId: result.user.id, pf: result.user.pf! });
  return res;
});
