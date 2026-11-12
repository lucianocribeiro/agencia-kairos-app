import { NextResponse, type NextRequest } from "next/server";

import { apiRoute, readJson } from "@/lib/auth/api";
import { HOME_BY_ROLE } from "@/lib/auth/constants";
import { requireUser } from "@/lib/auth/guards";
import { changePassword, PASSWORD_MESSAGES } from "@/lib/auth/password-change";
import { setSessionCookie } from "@/lib/auth/session";

/** POST /api/auth/password · body JSON { actual, nueva, repetir } → { redirectTo } + cookie nueva. */
export const POST = apiRoute(async (request: NextRequest) => {
  const user = await requireUser({ allowPendingPasswordChange: true });
  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: PASSWORD_MESSAGES.incompleto }, { status: 400 });

  const result = await changePassword(user.id, { actual: body.actual, nueva: body.nueva, repetir: body.repetir });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, field: result.field }, { status: result.status });
  }

  const res = NextResponse.json({ redirectTo: HOME_BY_ROLE[user.rol] });
  await setSessionCookie(res, { userId: user.id, pf: result.pf });
  return res;
});
