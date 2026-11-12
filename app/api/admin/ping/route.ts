import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/auth/api";
import { requireAdmin } from "@/lib/auth/guards";

/** GET /api/admin/ping · chequeo de sesión Admin. Primer endpoint bajo /api/admin. */
export const GET = apiRoute(async () => {
  const user = await requireAdmin();
  return NextResponse.json({ ok: true, rol: user.rol });
});
