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
- Todo hash de contraseña sale de `hashNewPassword()` (`lib/auth/password-hash.ts`, solo servidor); las reglas (10+ caracteres, máx. 72 bytes UTF-8, nunca truncar) están en `lib/auth/password-policy.ts`, que puede usar el cliente.
- Frontera cliente/servidor: desde un archivo `"use client"` no se puede llegar (ni transitivamente) a `lib/airtable/**`, `lib/env.ts` ni a `lib/auth/**` salvo `password-policy.ts` (test `test/client-boundary.test.ts`).
- Cliente de Airtable: los `create` no se reintentan nunca; `update`/`delete` sí ante 429/5xx.
- Dependencias con versión exacta (`.npmrc` con `save-exact=true`).
- Toda escritura a un usuario llama a `invalidateCachedUser(id)` (`lib/auth/user-cache.ts`).
- Nunca poner datos por usuario en `use cache` ni en otro caché entre requests.
- Interceptación de requests: `proxy.ts` (Next 16; `middleware.ts` está deprecado). Solo redirige a /login si falta la cookie o su firma es inválida.

## ABM de Usuarios y Maestros (CC-F1-03)

- Specs client-safe (sin IDs) en `lib/abm/`: `fields.ts` (tipos de campo, parseo, formato), `maestros.ts` (los 10 Maestros), `usuarios.ts`. Cliente y servidor validan con las mismas funciones; el servidor es la fuente de verdad.
- Parte de servidor en `lib/abm/server/`: `maestros-config.ts` (clave → ID de campo, unicidad, links permitidos, referencias, reglas como el Código de Proyectos y la cascada de siglas), `maestros-service.ts` (ABM genérico), `usuarios-service.ts`.
- Unicidad y referencias: `lib/airtable/integrity.ts` (`findDuplicates` con `LOWER(TRIM())`, `findReferences` sobre `REFERENCE_FIELDS` de `schema.ts`). Un registro con referencias no se borra (409).
- Las escrituras del hash de un usuario (alta y reset) también pasan por `lib/auth/credentials.ts`.
- Todo cambio a un usuario llama a `invalidateCachedUser(id)`.
- Estados HTTP de los ABM: reglas de campo → 400 (`WritePlan.invalid`); duplicados y choques con otros registros → 409 (`WritePlan.conflict`); tabla sin borrado → 405. `apiRoute` mapea `AirtableError`: not_found → 404, 429/5xx/red → 503, el resto → 500 (logs solo con código/status/tipo).
- Cascada de siglas de Clientes: todo se pre-valida antes de escribir; se escriben primero los proyectos (lotes de 10) y después el cliente, con compensación (`lib/abm/server/compensation.ts`). Si una escritura falla se revierte todo a los valores originales: rollback OK → 503 «No se modificó nada»; rollback fallido → 500 «quedó incompleto» y se loguean solo los IDs.
- Inyección de fallas para el smoke test: `lib/abm/server/fault-injection.ts`, solo con `NODE_ENV=development` y `KAIROS_FAULT_INJECTION=<punto>`. En `next build` queda como código muerto; `check:bundle` falla si el nombre de la variable aparece en `.next/server`.
- `toRawValues` solo acepta claves con forma de clave del spec (camelCase) en un objeto sin prototipo; los servicios ignoran toda clave que no esté en el spec.

## Concurrencia (riesgo residual)

Airtable no tiene transacciones ni restricciones de unicidad. Las reglas que dependen de otros registros se chequean antes de escribir y se **vuelven a verificar después**, compensando si otro request ganó la carrera:

- **Último Admin activo**: después de desactivar o pasar a Empleado a un Admin se releen los Admins activos; si quedan cero, esta escritura se revierte y responde 409.
- **Unicidad** (email y sigla de Usuarios, y cada campo único de los Maestros, incluido el Código de Proyectos): después de crear o editar se vuelve a buscar el valor. En un alta pierde el registro más nuevo (`createdTime` más reciente; empate: ID más alto) y se borra; en una edición, quien edita vuelve a su valor anterior. Después, 409 con el mensaje de duplicado.
- **Cascada de siglas**: después de escribir se verifica que ningún Código nuevo choque con otro proyecto; si choca, se revierte todo.

Es un chequeo no atómico con compensación. Queda una ventana chica en la que un duplicado (o cero Admins activos) puede existir unos milisegundos, y si el rollback falla queda un estado a medias que se loguea por ID. Con la escala actual (pocos usuarios Admin, escrituras manuales) es aceptable; si crece, hace falta un lock o una base con transacciones.
