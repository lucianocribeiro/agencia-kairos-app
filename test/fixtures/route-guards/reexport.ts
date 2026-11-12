// Fixture NEGATIVA: método re-exportado y wrapper local con el mismo nombre.
import { NextResponse } from "next/server";

const adminRoute = (h: () => Promise<Response>) => h;
const handler = adminRoute(async () => NextResponse.json({ ok: true }));
export const GET = adminRoute(async () => NextResponse.json({ ok: true }));
export { handler as DELETE };
