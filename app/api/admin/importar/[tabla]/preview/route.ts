import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/auth/api";
import { toResponse } from "@/lib/abm/server/http";
import { isKind } from "@/lib/ventas-compras/columns";
import { previewImport } from "@/lib/ventas-compras/server/service";
import { readUpload } from "@/lib/ventas-compras/server/upload";

type Context = { params: Promise<{ tabla: string }> };

/** Vercel Hobby: 300 s es el máximo (y el valor por defecto). La importación tarda segundos. */
export const maxDuration = 300;

/**
 * POST /api/admin/importar/:tabla/preview (tabla = ventas | compras) · multipart con
 * «archivo» (.xlsx de ARCA). Devuelve las filas, su estado y el contexto para editar.
 * No escribe nada.
 */
export const POST = adminRoute<Context>(async (request, _user, { params }) => {
  const { tabla } = await params;
  if (!isKind(tabla)) return NextResponse.json({ error: "No encontramos esa importación." }, { status: 404 });
  const upload = await readUpload(request);
  if (upload instanceof Response) return upload;
  return toResponse(await previewImport(tabla, upload.file));
});
