/**
 * Texto de un PDF, página por página (solo tests; pdfjs-dist es dependencia de desarrollo).
 * Cada línea = los ítems de texto con la misma coordenada Y, de izquierda a derecha.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function pdfText(bytes: Uint8Array): Promise<{ pages: string[][]; numPages: number }> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true });
  const doc = await task.promise;
  const pages: string[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      const y = Math.round(item.transform[5]);
      lines.set(y, [...(lines.get(y) ?? []), { x: item.transform[4], s: item.str }]);
    }
    pages.push(
      [...lines.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, items]) => items.sort((a, b) => a.x - b.x).map((it) => it.s).join(" ")),
    );
  }
  const numPages = doc.numPages;
  await task.destroy();
  return { pages, numPages };
}
