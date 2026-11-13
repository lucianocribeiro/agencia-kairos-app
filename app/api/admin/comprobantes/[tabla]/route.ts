import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { isKind } from "@/lib/ventas-compras/columns";
import { listComprobantes } from "@/lib/ventas-compras/server/comprobantes";

type Context = { params: Promise<{ tabla: string }> };

/**
 * GET /api/admin/comprobantes/:tabla (ventas | compras) · lista filtrada con totales.
 * Query: desde, hasta (AAAA-MM-DD; sin fechas = año actual), mesDesde, mesHasta (AAAA-MM),
 * contraparte, proyecto (ID o "sin"), categoria, control, pagina.
 */
export const GET = adminRoute<Context>(async (request, _user, { params }) => {
  const { tabla } = await params;
  if (!isKind(tabla)) return NextResponse.json({ error: "No encontramos esa lista." }, { status: 404 });
  const q = request.nextUrl.searchParams;
  const get = (k: string) => q.get(k) || null;
  const pagina = get("pagina");
  return toResponse(
    await listComprobantes(tabla, {
      desde: get("desde"),
      hasta: get("hasta"),
      mesDesde: get("mesDesde"),
      mesHasta: get("mesHasta"),
      contraparte: get("contraparte"),
      proyecto: get("proyecto"),
      categoria: get("categoria"),
      control: get("control"),
      pagina: pagina === null ? null : /^\d{1,6}$/.test(pagina) ? Number(pagina) : -1,
    }),
  );
});
