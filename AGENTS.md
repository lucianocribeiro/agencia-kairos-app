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
- `toRawValues(body, allowedKeys)` recibe explícitamente las claves del spec (`maestroInputKeys(slug)`, `USUARIO_INPUT_KEYS.create/edit`) y descarta todo lo demás; devuelve un objeto sin prototipo.
- Un payload de escritura que no pasa la pre-validación (campo calculado, de solo lectura, de otra tabla o ID de registro inválido) es un bug del servidor: 500 genérico, sin escribir nada, y en el log solo la tabla y los IDs de campo.

## Concurrencia (riesgo residual)

Airtable no tiene transacciones ni restricciones de unicidad. Las reglas que dependen de otros registros se chequean antes de escribir y se **vuelven a verificar después**, compensando si otro request ganó la carrera. Usuarios y Maestros usan la misma implementación (`runPostWriteChecks` en `lib/abm/server/compensation.ts`), y es **fail-closed**:

- conflicto → se deshace la escritura de este request → 409;
- la lectura de la verificación falla (cualquier error) → se deshace igual → 503 «No pudimos verificar el cambio. No se modificó nada; probá de nuevo.»;
- si el deshacer falla → 500 «El cambio quedó incompleto. Avisá a un administrador.»;
- el log lleva solo el ID del registro y el nombre de la verificación (`ultimoAdmin`, `unique:<clave>`, `cascade`), nunca valores.

Verificaciones:

- **Último Admin activo**: después de desactivar o pasar a Empleado a un Admin se releen los Admins activos; si quedan cero, esta escritura se revierte y responde 409.
- **Unicidad** (email y sigla de Usuarios, y cada campo único de los Maestros, incluido el Código de Proyectos): después de crear o editar se vuelve a buscar el valor. En un alta pierde el registro más nuevo (`createdTime` más reciente; empate: ID más alto) y se borra; en una edición, quien edita vuelve a su valor anterior. Después, 409 con el mensaje de duplicado.
- **Cascada de siglas**: después de escribir se verifica que ningún Código nuevo choque con otro proyecto; si choca, se revierte todo.

Es un chequeo no atómico con compensación. Queda una ventana chica en la que un duplicado (o cero Admins activos) puede existir unos milisegundos, y si el rollback falla queda un estado a medias que se loguea por ID. Con la escala actual (pocos usuarios Admin, escrituras manuales) es aceptable; si crece, hace falta un lock o una base con transacciones.

## Horas (CC-F1-04)

- Lógica compartida y client-safe en `lib/horas/`: `time.ts` (HH:mm ↔ segundos, `recordHours`, `sumHours`), `dates.ts` (fechas "YYYY-MM-DD", hoy en Buenos Aires, atajos, buckets), `rules.ts` (validación y superposición), `types.ts` (DTOs). Parte de servidor en `lib/horas/server/`.
- `recordHours` es la única cuenta de horas; los totales se suman con `sumHours` (en centésimas). No usar el campo fórmula Horas de Airtable en la app.
- Período: `fechaRangeFormula` (`AND({fecha}, IS_AFTER({fecha}, "desde − 1"), IS_BEFORE({fecha}, "hasta + 1"))`) y después se vuelve a filtrar en código por el string. Los filtros por link (colaborador, proyecto, cliente vía el Cliente del proyecto) se aplican en código con los IDs que devuelve la API, nunca por nombre.
- Superposición: chequeo previo (409) y `overlapPostCheck` en `runPostWriteChecks` (alta: pierde el más nuevo; edición: vuelve quien edita; fail-closed).
- Empleado: `/api/me/horas` (GET, POST) y `/api/me/proyectos` (GET). Nunca PATCH/PUT/DELETE en `/api/me/**` ni `/api/me/horas/[id]` (test). Colaborador = Cargado por = la sesión, Facturable = sí; las asignaciones se releen de Airtable en cada alta.
- Nunca leer RESTRICTED_FIELDS (valor hora, moneda, importe, cliente) en el camino del Empleado; las respuestas y los props de `/mis-horas` son DTOs explícitos.
- Toda verificación posterior que relee el registro escrito (superposición de Horas, unicidad de Usuarios y Maestros, cascada de siglas) lanza `WrittenRecordMissingError` si la relectura no lo trae: cuenta como lectura fallida → deshacer → 503 (500 si el deshacer falla). La de «último Admin activo» no depende del registro escrito (cuenta los demás Admins activos).
- Período máximo de los filtros: 10 años calendario exactos (`hasta ≤ desde + 10 años`, 29/02 → 28/02). La vista diaria del dashboard sigue limitada a 400 días.
- Mis horas: asignaciones y proyectos se leen una vez por request (`loadMisSnapshot`) y se pasan a `listMisHoras`; el alta siempre pide una foto nueva.

## Clientes Activo / Inactivo (CC-F2-01)

- Estado de Clientes: solo `Activo` / `Inactivo` (`lib/abm/cliente-estado.ts`). Todo chequeo de «cliente activo» usa `isClienteActivo()`: picker de Cliente en Proyectos (`links.clienteActivo.allow`), filtro de clientes de Horas (`ClienteOption.activo`) y Proyectos asignados de Usuarios (proyecto Activo **y** cliente Activo; el guardado valida con las mismas opciones, y lo ya asignado se conserva).
- La compatibilidad con las opciones viejas («Cliente» = Activo) se quitó en CC-F2-02, después de la migración: solo `Activo` es activo. Los literales viejos solo pueden estar en `scripts/lib/migrate-clientes-estado.mjs`, que se conserva con sus tests (test `test/legacy-literals.test.ts`).
- Sigla obligatoria (`required`) y de 2 letras para todo cliente; única (`unique`) con verificación posterior y cascada al Código de los proyectos, como antes.
- La lista de Clientes arranca filtrada en Activos (`MaestroSpec.estadoDefault` → `Filter.defaultValue`).
- Borrado de Clientes: `DELETE /api/admin/maestros/clientes/:id` (el mismo `deleteMaestro`). Con referencias (Proyectos, Ventas, Tesorería) → 409 con conteos (`CLIENTE_MESSAGES.referenciado`, «No se puede borrar: tiene 2 proyectos y 3 movimientos de Tesorería. Pasalo a Inactivo.»). El formulario primero llama a `GET /api/admin/maestros/:tabla/:id/referencias` (aviso previo, `{ blocked, message, counts: { proyectos, ventas, tesoreria } }`: solo categorías y cantidades, nunca IDs de campo): con referencias muestra el mensaje; sin referencias abre `ConfirmDialog`. El DELETE vuelve a leer las referencias justo antes de borrar.
- **Carrera residual del borrado** (sin compensación, a propósito): entre la relectura de referencias y el delete hay unos milisegundos en los que otro request puede linkear el cliente (p. ej. crear un proyecto). Airtable borra igual y ese link queda vacío en el proyecto/venta/movimiento. Con la escala actual (borrados manuales y raros) es aceptable.
- `scripts/migrate-clientes-estado.mjs` (lógica en `scripts/lib/`, test en `test/migrate-clientes-estado.test.ts`): dry-run por defecto, snapshot en `backups/` (gitignored), nunca usa typecast. `--apply` escribe primero el archivo de reanudación (0600, fsync, nunca se pisa); una corrida posterior solo acepta leads faltantes si ese archivo existe, coincide con el plan y los lista. Ver README, «Orden de despliegue».
- Meta API (verificado en CC-F2-01): se puede cambiar la fórmula de un campo fórmula; NO se pueden editar opciones de un singleSelect, ni la precisión, ni borrar campos (eso se hace en la interfaz).

## Importación ARCA de Ventas y Compras (CC-F2-02)

- Lógica client-safe en `lib/ventas-compras/`: `columns.ts` (columnas ARCA; la clave de cada columna = la clave del campo en `schema.ts`), `rules.ts` (celdas, código/signo, TC, moneda, importes, Clave ARCA, `evaluar` con el Control), `rows.ts` (encabezados y filas → `FilaBase` con estado), `money.ts` (ROUND de Excel en centavos), `types.ts`. La vista previa recalcula en el navegador con las mismas funciones; el servidor es la fuente de verdad.
- Servidor en `lib/ventas-compras/server/`: `upload.ts` (multipart; 4 MB; Origin del mismo sitio), `context.ts` (una lectura de la base por request), `service.ts` (`previewImport`, `confirmImport`, `validarEdiciones`, `camposDeFila`). Lector de .xlsx sin dependencias en `lib/xlsx/read.ts` (ZIP con `node:zlib`). Todo el archivo es hostil: ≤ 1.000 entradas; offsets y largos del directorio central y de los headers locales dentro del archivo; tamaño descomprimido = declarado; ≤ 40 MB por entrada y 60 MB en total; ZIP64 y cifrado rechazados; Target de la hoja resuelto canónicamente y solo dentro de `xl/worksheets/`; referencias de fila (1..1.100) y columna (A..BL) validadas antes de reservar memoria; entidades XML inválidas rechazadas. Cualquier problema → `XlsxError` → 400.
- Rutas: `POST /api/admin/importar/[tabla]/preview` y `/confirmar` (`tabla` = ventas | compras), con `adminRoute` y `maxDuration = 300`. Páginas `/ventas/importar` y `/compras/importar` con `<Guarded admin>`.
- Confirmar es sin estado: se vuelve a mandar el archivo; del cliente solo se aceptan las ediciones (`EDICION_KEYS`), validadas contra el contexto (proyecto Activo, categoría del tipo correcto, socio solo en Compras, mes `AAAA-MM`, observaciones ≤ 2000). Una edición inválida → 400 sin escribir nada.
- Se escriben: columnas ARCA, Tipo comprobante, Clave ARCA, Cliente (Ventas) o Proveedor (Compras) y solo lo que el usuario editó; en Compras también la Categoría por defecto del proveedor. Los valores efectivos por defecto (Mes devengado, UN del proyecto, categoría de Ventas) no se escriben.
- Escritura con `Compensation.createMany` (lotes de 10, create sin reintentos) y rollback de todo lo de esta importación. Fallas inyectables: `import:proveedores:<n>`, `import:ventas:<n>`, `import:compras:<n>` (antes del lote n).
- Verificación posterior (fail-closed): `losesUniqueRace` por cada proveedor creado (pierde → se deshace todo, 409) y `findUniqueRaceLosers` (integrity.ts) para las Claves ARCA en una sola lectura: gana el registro más viejo, las filas propias que pierden se borran con `Compensation.discardCreated` y se informan como «importadas en paralelo». Si la relectura falla → se deshace todo → 503.
- Riesgo residual: un create que Airtable aplica pero responde con error (5xx) deja filas que esta importación no conoce y el rollback no borra; una nueva importación las ve como «Ya importada». Mismo riesgo que los create de Fase 1.
- Tests con archivos sintéticos (`test/xlsx-fixture.ts`, `test/arca-fixture.ts`; CUITs inventados con dígito verificador válido). Nunca commitear archivos, CUITs ni importes reales.
