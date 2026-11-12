import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/auth/api";

/** GET /api/admin/ping · chequeo de sesión Admin. */
export const GET = adminRoute(async (_request, user) => NextResponse.json({ ok: true, rol: user.rol }));
