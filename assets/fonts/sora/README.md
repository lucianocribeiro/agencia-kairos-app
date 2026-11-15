# Sora (fuente del PDF de la proforma)

- Archivos: `Sora-Regular.ttf` y `Sora-SemiBold.ttf` (estáticos).
- Origen: https://github.com/sora-xor/sora-font, carpeta `fonts/ttf`, commit `7f9a9c5d0ccd1c099cfac420aa27133df1c5fdc4`.
- SHA-256: Regular `517e945dedbeeb8d700ccae77d189a6ef2a01f6dcc95ba5d032ef9a30f7f0de9`, SemiBold `b02621d4009da9a18eb8a5cbe277f084eb9c3f065ba08a6e77769e81863becf2`.
- Licencia: SIL Open Font License 1.1 (`OFL.txt`, copiado del mismo repo). Permite embeber la fuente en documentos y redistribuirla junto con la licencia.
- Uso: `lib/proforma/pdf.ts` la embebe como subset (`@pdf-lib/fontkit`).
