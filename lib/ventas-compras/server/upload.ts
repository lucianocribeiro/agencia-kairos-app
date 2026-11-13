import "server-only";

import { NextResponse, type NextRequest } from "next/server";

/**
 * Lectura del .xlsx subido (multipart/form-data). Límites pensados para Vercel
 * Functions: el body de un request no puede pasar 4,5 MB (413 FUNCTION_PAYLOAD_TOO_LARGE).
 * El archivo se limita a 4 MB y el resto del body (ediciones) a 400 KB, así el total
 * queda por debajo. Ver README, «Importación ARCA».
 */

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_EDICIONES_BYTES = 400 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + MAX_EDICIONES_BYTES + 64 * 1024;

export const UPLOAD_MESSAGES = {
  formato: "Subí el archivo como formulario (multipart/form-data).",
  origen: "El pedido no viene de esta aplicación.",
  muyGrande: "El archivo supera los 4 MB. Exportá un período más corto desde ARCA.",
  sinArchivo: "Elegí el archivo .xlsx de ARCA.",
  extension: "El archivo tiene que ser un .xlsx (Excel) descargado de ARCA.",
  ediciones: "Las ediciones no tienen el formato esperado.",
} as const;

const err = (status: number, error: string) => NextResponse.json({ error }, { status });

export interface Upload {
  file: Uint8Array;
  /** Ediciones (JSON) si vinieron; undefined si no. */
  ediciones: unknown;
}

/**
 * Valida y lee el pedido. Defensa extra contra CSRF (la cookie ya es SameSite=Lax):
 * si viene `Origin`, tiene que ser el mismo host.
 */
export async function readUpload(request: NextRequest): Promise<Upload | Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return err(403, UPLOAD_MESSAGES.origen);
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("multipart/form-data")) return err(415, UPLOAD_MESSAGES.formato);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return err(413, UPLOAD_MESSAGES.muyGrande);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err(400, UPLOAD_MESSAGES.formato);
  }
  const archivo = form.get("archivo");
  if (!archivo || typeof archivo === "string") return err(400, UPLOAD_MESSAGES.sinArchivo);
  if (archivo.size > MAX_FILE_BYTES) return err(413, UPLOAD_MESSAGES.muyGrande);
  if (!/\.xlsx$/i.test(archivo.name)) return err(400, UPLOAD_MESSAGES.extension);
  const file = new Uint8Array(await archivo.arrayBuffer());
  // Un .xlsx es un ZIP: empieza con "PK\x03\x04".
  if (file.length < 4 || file[0] !== 0x50 || file[1] !== 0x4b || file[2] !== 0x03 || file[3] !== 0x04) return err(400, UPLOAD_MESSAGES.extension);

  let ediciones: unknown;
  const raw = form.get("ediciones");
  if (raw !== null) {
    if (typeof raw !== "string" || raw.length > MAX_EDICIONES_BYTES) return err(400, UPLOAD_MESSAGES.ediciones);
    try {
      ediciones = JSON.parse(raw);
    } catch {
      return err(400, UPLOAD_MESSAGES.ediciones);
    }
  }
  return { file, ediciones };
}
