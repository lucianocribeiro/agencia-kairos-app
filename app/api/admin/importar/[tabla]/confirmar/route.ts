import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { isKind } from "@/lib/ventas-compras/columns";
import { confirmImport } from "@/lib/ventas-compras/server/service";
import { readUpload } from "@/lib/ventas-compras/server/upload";

type Context = { params: Promise<{ tabla: string }> };

/** Vercel Hobby: 300 s es el máximo (y el valor por defecto). */
export const maxDuration = 300;

/**
 * POST /api/admin/importar/:tabla/confirmar · multipart con «archivo» (el mismo .xlsx)
 * y «ediciones» (JSON por Clave ARCA). Sin estado: vuelve a leer el archivo, recalcula
 * todo y escribe solo las filas nuevas (lotes de 10, con compensación).
 */
export const POST = adminRoute<Context>(async (request, _user, { params }) => {
  const { tabla } = await params;
  if (!isKind(tabla)) return NextResponse.json({ error: "No encontramos esa importación." }, { status: 404 });
  const upload = await readUpload(request);
  if (upload instanceof Response) return upload;
  return toResponse(await confirmImport(tabla, upload.file, upload.ediciones));
});
