import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { generarProformaPdf } from "@/lib/proforma/pdf";
import { PROFORMA_MESSAGES } from "@/lib/proforma/proforma";
import { pdfAssets } from "@/lib/proforma/server/assets";
import { cargarProforma, nombreArchivoPdf } from "@/lib/proforma/server/service";

/**
 * GET /api/admin/proforma/pdf?cliente=rec…&mes=AAAA-MM[&tc=1.050,25] · la misma proforma como PDF
 * (adjunto). Sin horas que cuenten → 404 con el mensaje (no hay documento). No-store.
 */
export const GET = adminRoute(
  async (request) => {
    const q = request.nextUrl.searchParams;
    const res = await cargarProforma({ cliente: q.get("cliente"), mes: q.get("mes"), tc: q.get("tc") });
    if (!res.ok) return toResponse(res);
    if (res.data.vacia) return NextResponse.json({ error: PROFORMA_MESSAGES.vacia(res.data.mesLabel) }, { status: 404 });
    const bytes = await generarProformaPdf(res.data, await pdfAssets());
    const filename = nombreArchivoPdf(res.data);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "content-length": String(bytes.length),
      },
    });
  },
  { noStore: true },
);
