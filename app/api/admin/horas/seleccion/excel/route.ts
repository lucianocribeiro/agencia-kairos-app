import { adminRoute, readJsonBody } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { cargarSeleccion, seleccionXlsx } from "@/lib/horas/server/seleccion-service";
import { XLSX_CONTENT_TYPE } from "@/lib/xlsx/write";

/** POST /api/admin/horas/seleccion/excel · mismos IDs y validaciones; la vista de la pantalla como .xlsx. */
export const POST = adminRoute(
  async (request) => {
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const res = await cargarSeleccion(body);
    if (!res.ok) return toResponse(res);
    const { bytes, filename } = seleccionXlsx(res.data);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": XLSX_CONTENT_TYPE,
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(bytes.length),
      },
    });
  },
  { noStore: true },
);
