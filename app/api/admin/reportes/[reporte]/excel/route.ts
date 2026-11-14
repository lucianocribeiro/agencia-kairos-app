import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { isReporteSlug } from "@/lib/reportes/excel";
import { cargarReporte, reporteXlsx } from "@/lib/reportes/server/service";
import { XLSX_CONTENT_TYPE } from "@/lib/xlsx/write";

type Context = { params: Promise<{ reporte: string }> };

export const maxDuration = 300;

/** GET /api/admin/reportes/:reporte/excel?desde=AAAA-MM · el mismo reporte como .xlsx (adjunto). */
export const GET = adminRoute<Context>(async (request, _user, { params }) => {
  const { reporte } = await params;
  if (!isReporteSlug(reporte)) return NextResponse.json({ error: "No encontramos ese reporte." }, { status: 404 });
  const res = await cargarReporte(reporte, request.nextUrl.searchParams.get("desde") || null);
  if (!res.ok) return toResponse(res);
  const { bytes, filename } = reporteXlsx(res.data);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": XLSX_CONTENT_TYPE,
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(bytes.length),
      "cache-control": "no-store",
    },
  });
});
