import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PdfAssets } from "../pdf";

/**
 * Fuentes Sora (OFL, assets/fonts/sora) y logo claro (assets/brand). Se leen del disco una
 * vez por instancia; next.config.ts los suma al trace de la función del PDF
 * (`outputFileTracingIncludes`). No son datos de usuario: se pueden reusar entre requests.
 */
let cache: Promise<PdfAssets> | null = null;

export function pdfAssets(): Promise<PdfAssets> {
  cache ??= (async () => {
    const root = process.cwd();
    const [regular, semibold, logo] = await Promise.all([
      readFile(path.join(root, "assets/fonts/sora/Sora-Regular.ttf")),
      readFile(path.join(root, "assets/fonts/sora/Sora-SemiBold.ttf")),
      readFile(path.join(root, "assets/brand/logo-kairos-pdf.png")),
    ]);
    return { regular, semibold, logo };
  })().catch((err) => {
    cache = null;
    throw err;
  });
  return cache;
}
