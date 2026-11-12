// Fixture NEGATIVA: método declarado como función (aunque llame al guard adentro).
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/guards";

export async function GET() {
  await requireAdmin();
  return NextResponse.json({ ok: true });
}
