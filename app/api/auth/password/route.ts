import { NextResponse, type NextRequest } from "next/server";

import { apiRoute, readJsonBody } from "@/lib/auth/api";
import { HOME_BY_ROLE } from "@/lib/auth/constants";
import { requireUser } from "@/lib/auth/guards";
import { clientIp } from "@/lib/auth/login";
import { changePassword } from "@/lib/auth/password-change";
import { setSessionCookie } from "@/lib/auth/session";

/**
 * POST /api/auth/password · body JSON { actual, nueva, repetir } → { redirectTo } + cookie nueva.
 * Usa apiRoute + requireUser({ allowPendingPasswordChange }) en vez de userRoute: es la única
 * API permitida mientras «Debe cambiar password» está activo.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  const user = await requireUser({ allowPendingPasswordChange: true });
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const result = await changePassword(
    user,
    { actual: body.actual, nueva: body.nueva, repetir: body.repetir },
    clientIp(request.headers),
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error, field: result.field }, { status: result.status });
  }

  const res = NextResponse.json({ redirectTo: HOME_BY_ROLE[user.rol] });
  await setSessionCookie(res, { userId: user.id, pf: result.pf });
  return res;
});
