// Fixture NEGATIVA para /api/admin: usa userRoute en vez de adminRoute.
import { NextResponse } from "next/server";

import { userRoute } from "@/lib/auth/api";

export const GET = userRoute(async () => NextResponse.json({ ok: true }));
