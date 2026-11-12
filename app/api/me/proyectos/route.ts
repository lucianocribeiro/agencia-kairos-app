import { NextResponse } from "next/server";

import { userRoute } from "@/lib/auth/api";
import { loadMisProyectos } from "@/lib/horas/server/me-service";

/** GET /api/me/proyectos · proyectos asignados y Activos del usuario, como { id, codigo }. */
export const GET = userRoute(async (_request, user) => {
  const { activos } = await loadMisProyectos(user.id);
  return NextResponse.json({ ok: true, proyectos: activos.map((p) => ({ id: p.id, codigo: p.codigo })) });
});
