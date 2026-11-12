// Fixture NEGATIVA (solo para test/route-guards.test.ts): GET protegido, POST sin proteger.
import { NextResponse } from "next/server";

import { adminRoute, apiRoute } from "@/lib/auth/api";

export const GET = adminRoute(async () => NextResponse.json({ ok: true }));
export const POST = apiRoute(async () => NextResponse.json({ ok: true }));
