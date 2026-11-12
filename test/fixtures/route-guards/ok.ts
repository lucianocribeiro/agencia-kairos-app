// Fixture POSITIVA: todos los métodos envueltos (con alias de import incluido).
import { NextResponse } from "next/server";

import { adminRoute as guarded } from "@/lib/auth/api";

export const GET = guarded(async (_request, user) => NextResponse.json({ rol: user.rol }));
export const PATCH = guarded(async () => NextResponse.json({ ok: true }));
