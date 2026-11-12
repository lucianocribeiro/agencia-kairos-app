<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Reglas del proyecto (Agencia Kairos)

- Airtable se accede solo desde `lib/airtable/`, y cada archivo ahí importa `server-only`. El token nunca llega al navegador. Nada de `NEXT_PUBLIC_` para secretos.
- Siempre IDs de tabla y de campo (`lib/airtable/schema.ts`), nunca nombres. Lecturas con `returnFieldsByFieldId`, escrituras por ID de campo.
- No escribir campos de `COMPUTED_FIELDS` ni `READ_ONLY_FIELDS`. No devolver `RESTRICTED_FIELDS` a un Empleado ni `SECRET_FIELDS` a nadie (`lib/airtable/access.ts`).
- Textos de UI en es-AR con voseo. Fechas DD/MM/AAAA, números es-AR (`lib/format.ts`).
- Nada de azul en la UI: solo los tokens de `app/globals.css`.
- Antes de un PR: `npm run lint`, `npm run build`, `npm test`, `npm run check:bundle`.
