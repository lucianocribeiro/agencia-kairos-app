import { toResponse } from "@/lib/abm/server/http";
import { clienteRoute } from "@/lib/auth/api";
import { cargarVistaCliente, clienteXlsx, queryCliente } from "@/lib/cliente/server/service";
import { XLSX_CONTENT_TYPE } from "@/lib/xlsx/write";

export const maxDuration = 300;

/** GET /api/cliente/horas/excel?… (mismos filtros) · exactamente lo que muestra la pantalla, como .xlsx. */
export const GET = clienteRoute(async (request, user) => {
  const q = request.nextUrl.searchParams;
  const res = await cargarVistaCliente(user.id, queryCliente((k) => q.get(k)));
  if (!res.ok) return toResponse(res);
  const { bytes, filename } = clienteXlsx(res.data);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": XLSX_CONTENT_TYPE,
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(bytes.length),
    },
  });
}, { noStore: true });
