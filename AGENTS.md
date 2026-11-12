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

## Convención de autenticación y APIs (resto de Fase 1)

- Toda mutación pasa por un Route Handler (no Server Actions). Wrappers en `lib/auth/api.ts`.
- Endpoints de Admin: `app/api/admin/**`. Cada método exportado es `export const GET = adminRoute(async (request, user) => { ... })` (igual POST/PUT/PATCH/DELETE); `adminRoute` corre `requireAdmin()` antes del handler. Nada de `export async function GET`.
- Endpoints de Empleado: `app/api/me/**`, con `export const GET = userRoute(...)` (corre `requireUser()`).
- `test/route-guards.test.ts` lo verifica por AST (TypeScript compiler API) y falla si un método no está envuelto.
- Rutas públicas de auth (`app/api/auth/**`) usan `apiRoute` directo. Todo POST lee el body con `readJsonBody` (415 si no es JSON).
- Las respuestas a un Empleado pasan por el recorte por rol de `lib/airtable/access.ts` (`readableFields` / `redactFields`).
- Cada página protegida envuelve su contenido en `<Guarded>` / `<Guarded admin>` (`components/auth/guarded.tsx`): el guard del layout no alcanza porque los layouts no se re-renderizan al navegar.
- `Usuarios.passwordHash` solo se lee en `lib/auth/credentials.ts` (test `test/password-hash-reader.test.ts`).
- Todo hash de contraseña sale de `hashNewPassword()` (`lib/auth/password.ts`): 10+ caracteres y máx. 72 bytes UTF-8 (bcrypt). Nunca truncar.
- Cliente de Airtable: los `create` no se reintentan nunca; `update`/`delete` sí ante 429/5xx.
- Dependencias con versión exacta (`.npmrc` con `save-exact=true`).
- Toda escritura a un usuario llama a `invalidateCachedUser(id)` (`lib/auth/user-cache.ts`).
- Nunca poner datos por usuario en `use cache` ni en otro caché entre requests.
- Interceptación de requests: `proxy.ts` (Next 16; `middleware.ts` está deprecado). Solo redirige a /login si falta la cookie o su firma es inválida.
