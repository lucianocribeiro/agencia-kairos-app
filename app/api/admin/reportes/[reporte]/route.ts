import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { isReporteSlug } from "@/lib/reportes/excel";
import { cargarReporte } from "@/lib/reportes/server/service";

type Context = { params: Promise<{ reporte: string }> };

/** Vercel Hobby: 300 s es el máximo. Los reportes leen Ventas, Compras y Tesorería completas. */
export const maxDuration = 300;

/**
 * GET /api/admin/reportes/:reporte (resultados | resultados-por-proyecto | socios | saldos)
 * · Query: desde = AAAA-MM (sin desde = Parámetro «Primer mes de los reportes»; Saldos no usa período).
 * · Respuesta: { ok, reporte, data (objeto de resultado, centavos), vista (lo mismo que muestra la pantalla) }.
 */
export const GET = adminRoute<Context>(async (request, _user, { params }) => {
  const { reporte } = await params;
  if (!isReporteSlug(reporte)) return NextResponse.json({ error: "No encontramos ese reporte." }, { status: 404 });
  const res = await cargarReporte(reporte, request.nextUrl.searchParams.get("desde") || null);
  if (!res.ok) return toResponse(res);
  return NextResponse.json({ ok: true, reporte, data: res.data.data, vista: res.data.vista }, { headers: { "cache-control": "no-store" } });
});
