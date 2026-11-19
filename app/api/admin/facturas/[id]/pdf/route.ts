import { toResponse } from "@/lib/abm/server/http";
import { adminRoute } from "@/lib/auth/api";
import { nombreArchivoFactura } from "@/lib/factura/factura";
import { generarFacturaPdf } from "@/lib/factura/pdf";
import { datosParaPdf } from "@/lib/factura/server/service";
import { pdfAssets } from "@/lib/proforma/server/assets";

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/facturas/:id/pdf · PDF de una factura Autorizada, armado desde el snapshot
 * guardado (CC-F5-10). «Factura_A_<PV5>-<N8>.pdf». No-store.
 */
export const GET = adminRoute<Context>(
  async (_request, _user, { params }) => {
    const { id } = await params;
    const res = await datosParaPdf(id);
    if (!res.ok) return toResponse(res);
    const bytes = await generarFacturaPdf(res.data, await pdfAssets());
    const filename = nombreArchivoFactura(res.data.puntoVenta, res.data.numero);
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
