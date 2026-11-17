<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Reglas del proyecto (Agencia Kairos)

- Airtable se accede solo desde `lib/airtable/`, y cada archivo ahí importa `server-only`. El token nunca llega al navegador. Nada de `NEXT_PUBLIC_` para secretos.
- Siempre IDs de tabla y de campo (`lib/airtable/schema.ts`), nunca nombres. Lecturas con `returnFieldsByFieldId`, escrituras por ID de campo.
- Airtable es solo una base de datos. No crear campos calculados (fórmula, rollup, lookup, count) en Airtable. Toda regla y todo cálculo viven en la app.
- No escribir campos de `COMPUTED_FIELDS` (solo autoNumber y createdTime, que llena Airtable) ni `READ_ONLY_FIELDS`. No devolver `RESTRICTED_FIELDS` a un Empleado ni `SECRET_FIELDS` a nadie (`lib/airtable/access.ts`).
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
- `recordHours` es la única cuenta de horas; los totales se suman con `sumHours` (en centésimas).
- Período: `fechaRangeFormula` (`AND({fecha}, IS_AFTER({fecha}, "desde − 1"), IS_BEFORE({fecha}, "hasta + 1"))`) y después se vuelve a filtrar en código por el string. Los filtros por link (colaborador, proyecto, cliente vía el Cliente del proyecto) se aplican en código con los IDs que devuelve la API, nunca por nombre.
- Superposición: chequeo previo (409) y `overlapPostCheck` en `runPostWriteChecks` (alta: pierde el más nuevo; edición: vuelve quien edita; fail-closed).
- Empleado: `/api/me/horas` (GET, POST) y `/api/me/proyectos` (GET). Nunca PATCH/PUT/DELETE en `/api/me/**` ni `/api/me/horas/[id]` (test). Colaborador = Cargado por = la sesión, Facturable = sí; las asignaciones se releen de Airtable en cada alta.
- Nunca leer valor hora, moneda ni cliente de Proyectos (RESTRICTED_FIELDS), ni importes, en el camino del Empleado; las respuestas y los props de `/mis-horas` son DTOs explícitos.
- Toda verificación posterior que relee el registro escrito (superposición de Horas, unicidad de Usuarios y Maestros, cascada de siglas) lanza `WrittenRecordMissingError` si la relectura no lo trae: cuenta como lectura fallida → deshacer → 503 (500 si el deshacer falla). La de «último Admin activo» no depende del registro escrito (cuenta los demás Admins activos).
- Período máximo de los filtros: 10 años calendario exactos (`hasta ≤ desde + 10 años`, 29/02 → 28/02). La vista diaria del dashboard sigue limitada a 400 días.
- Mis horas: asignaciones y proyectos se leen una vez por request (`loadMisSnapshot`) y se pasan a `listMisHoras`; el alta siempre pide una foto nueva.
- Mes a facturar (CC-F4-03): obligatorio en toda alta y edición, validado en el servidor («Elegí el mes a facturar.»); se guarda siempre como día 1 (`mesAFacturarToStorage`). Admin alta: precargado con el mes de la Fecha y lo sigue hasta que el Admin lo cambia a mano (`mesFormInicial`, `mesFormAlCambiarFecha`). En el formulario son dos selects, Mes (Enero…Diciembre) y Año (2000–2099, como los reportes; `MESES`, `aniosMesAFacturar`, `partesMes`, `unirMes`); vacío cualquiera de los dos → «Elegí el mes a facturar.». Admin edición: el guardado (legacy vacío → el mes de la Fecha); cambiar la Fecha no lo toca. Empleado: no lo ve ni lo manda; el servidor guarda el mes de la Fecha (`mesDeFecha`). Proforma sigue con `mesEfectivo` (guardado o, si está vacío, el mes de la Fecha).
- Selección de horas (CC-F4-05, solo Admin › Horas): checkbox por fila, solo Facturables y de un mismo proyecto (`motivoNoSeleccionable`); «seleccionar todo» solo con la lista filtrada a un proyecto; cambiar un filtro o recargar la lista limpia la selección (la lista no se pagina: la selección es siempre de filas visibles). `POST /api/admin/horas/seleccion` y `/seleccion/excel` (`adminRoute`, `noStore`) reciben solo `{ ids }` (≤ 500), releen todo de Airtable (lotes de 100) y validan existencia, Facturable y un solo proyecto (400); alícuota inválida → 409 como la Proforma. Importes con `importeRegistro` / `totalesPorMoneda` de la Proforma (`calcularSeleccion` en `lib/horas/seleccion.ts`); pantalla y Excel salen de `vistaSeleccion`. No guarda nada.
- Agrupaciones del dashboard (Admin y Cliente, también el xlsx): Diaria, Semanal, Mensual y Anual (`GROUPINGS`, `bucketKey`, `buildBuckets`). Anual = año calendario, etiqueta «AAAA»; los años de los bordes quedan recortados al rango.

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

## Listas de Ventas y Compras (CC-F2-03)

- `lib/ventas-compras/listado.ts` (puro): `ComprobanteGuardado` (registro por clave de schema) → `aFila` → `evaluar` (el mismo de la importación) → `FilaListado`; `filtrar`, `totalizar` (centavos), `ordenar`, `CONTROL_FILTROS`. Lo guardado vacío = sin edición (vale el valor por defecto); en Compras, la categoría vacía cae en la del proveedor.
- Servidor: `lib/ventas-compras/server/comprobantes.ts` (`listComprobantes`, `updateComprobante`, `deleteComprobante`); contexto compartido con la importación (`loadImportContext(kind, { claves: false })`).
- Rutas: `GET /api/admin/comprobantes/[tabla]`, `PATCH` y `DELETE /api/admin/comprobantes/[tabla]/[id]`, con `adminRoute`. La edición usa `toRawValues(body, COMPROBANTE_INPUT_KEYS[kind])` y la misma `validarEdicion` que la importación (`proyectoActual` permite mantener un proyecto no Activo). Ventas: al guardar se escribe el link Cliente con la regla efectiva.
- El Cliente efectivo de Ventas se calcula al leer (proyecto → CUIT → ninguno); los reportes futuros tienen que usar ese, no el link guardado. Un CUIT que coincide con más de un cliente es ambiguo: sin match, nunca se linkea (`clientesPorCuit` en context.ts solo tiene CUITs únicos). Clientes › CUIT es único (`unique: ["nombre", "sigla", "cuit"]`).
- Edición (PATCH): se escriben solo las claves enviadas (validadas) y, en Ventas, el link Cliente recalculado sobre lo guardado con lo enviado encima. Política de concurrencia: **gana el último que escribe** el mismo campo (no hay control de versión; aceptado). Ediciones de campos distintos no se pisan.
- Escala: la lista corta con 400 si el rango de Fechas tiene más de `MAX_FILAS_LISTA` (5.000) comprobantes; la ruta y las páginas tienen `maxDuration = 300`.
- Nav: los hijos con la misma ruta que el grupo usan `exact: true` (`isActivePath(pathname, href, exact)`).

## Tesorería (CC-F2-04)

- Reglas puras en `lib/tesoreria/rules.ts` (`evaluarMovimiento`, `validarMovimiento`, `saldoCorrido`, `CONTROL`); importes en centavos con `toCents` de `lib/ventas-compras/money.ts`. La validación del servidor bloquea todo Control ≠ OK más las reglas del formulario (tercero según el movimiento, nunca los dos, transferencia solo por su formulario, decimales).
- Servidor: `lib/tesoreria/server/movimientos.ts` (contexto, lista con saldo, alta/edición/borrado) y `transferencias.ts`. Rutas: `GET`/`POST /api/admin/tesoreria`, `PATCH`/`DELETE /api/admin/tesoreria/[id]`, `POST /api/admin/tesoreria/transferencias`, `PATCH`/`DELETE /api/admin/tesoreria/transferencias/[transferencia]`, todas con `adminRoute`; la lista con `maxDuration = 300` y límite de 5.000 filas en el rango.
- Edición de un movimiento: valida el registro completo (guardado + enviado) y escribe solo lo enviado; gana el último que escribe. Un registro con `transferencia` no se edita ni se borra por las rutas de movimientos (409).
- Transferencias (`transferencias.ts`): ID `TR-<uuid>` nuevo por transferencia; tipo por nombre (`TIPO_TRANSFERENCIA`), protegido en Maestros (ver «Tipos de operación por nombre»; además no cambian Movimiento / Suma / Es de socio). **Todo se reconcilia por ID de transferencia** (todo registro con ese ID es de esa transferencia), así se cubren las escrituras ambiguas de Airtable (aplicadas pero respondidas con error):
  - Alta: los 2 registros en UN create (sin reintentos). Ante error o verificación fallida (exactamente 2 registros con todos los valores esperados) → se borra todo lo que tenga el ID en un pedido y se relee: 0 → 503; si no → 500 con los IDs en el log.
  - Edición: foto del par; relectura justo antes de escribir (distinto → 409 sin escribir); UN update con los 2; verificación de todos los campos y de los IDs de la foto. Si algo falla, se relee y se clasifica cada pata: «nuestra» (lo que quisimos escribir), «original» (la foto) o «ajena» (otra cosa, o no está). 2 nuestras → 200; 2 originales → 503 sin escribir; nuestras + originales → se restauran solo las nuestras (un pedido) y se verifica → 503 (sin verificar → 500); alguna ajena → no se escribe nada: par consistente → 409 «Otra persona editó…», si no → 500. **Nunca se restaura una pata ajena.**
  - Riesgo residual: Airtable no tiene compare-and-swap, así que un cambio de otra persona que llegue entre la última relectura y la restauración de una pata «nuestra» todavía puede pisarse. La ventana es un solo pedido; si pasa, la red de seguridad lo marca («Transferencia inconsistente»).
  - Borrado: todo lo que tenga el ID en UN delete; relectura: 0 → 200 (aunque el delete haya respondido error); si quedan, un reintento con esos IDs; si siguen → 500. Nunca se recrean registros.
  - Red de seguridad: un ID que no comparten exactamente un Pago y una Cobranza → Control «Transferencia incompleta» (primero); un par completo con patas distintas en fecha, importe, TC o descripción, o con cuentas de distinta moneda → «Transferencia inconsistente» (`patasConsistentes` en rules.ts, segundo). El borrado de par acepta pares incompletos; un par inconsistente se arregla editándolo (reescribe las 2 patas).
  - Alta: con la respuesta OK del create, la verificación exige exactamente los IDs creados (Pago, Cobranza); sin respuesta, se reconcilia por ID de transferencia.
  - Fallas inyectables: `transferencia:crear:respuesta`, `transferencia:crear:verificar`, `transferencia:editar:verificar`, `transferencia:borrar:respuesta`.
- Fechas de Tesorería: `isIsoDate` de `lib/horas/dates.ts` (fechas reales).
- Campo «Transferencia» (fldx7UFCK79B1XzIr) creado por Meta API en CC-F2-04.
- Cuentas: la Moneda no cambia si la cuenta tiene movimientos (`MaestroSpec.bloqueadoConReferencias` en la UI; `cuentasBeforeWrite` en maestros-config.ts: 409 antes de escribir y, si la Moneda cambió, verificación posterior que relee las referencias: un movimiento creado en el medio → se deshace → 409; relectura fallida → se deshace → 503). Así la moneda que usan la verificación de las transferencias y la red de seguridad no cambia por debajo. Mismo riesgo residual que el resto de las verificaciones posteriores (ventana de milisegundos sin transacciones).

## Reportes (CC-F3-05)

- Funciones puras en `lib/reportes/` (`resultados.ts`, `por-proyecto.ts`, `socios.ts`, `saldos.ts`, `periodo.ts`), con datos ya evaluados (`normalizar.ts`: `aComprobanteR` desde `evaluarComprobante`, `aMovimientoR` desde `evaluarMovimiento`). Nunca recalcular importes ni valores efectivos de otra forma: siempre las reglas de `lib/ventas-compras` y `lib/tesoreria`. Sumas en centavos enteros.
- Servidor: `lib/reportes/server/load.ts` (lecturas con los campos justos: `COMPROBANTE_FIELDS`, `MOVIMIENTO_FIELDS`, `HORA_FIELDS`) y `service.ts` (`cargarReporte` → `{ data, vista }`; `reporteXlsx`). Rutas `GET /api/admin/reportes/[reporte]` y `/[reporte]/excel` con `adminRoute` y `maxDuration = 300`; páginas `app/(admin)/reportes/*` con `<Guarded admin>`, sin caché entre requests.
- La pantalla (`components/reportes/report-view.tsx`) y el Excel (`lib/reportes/excel.ts` → `lib/xlsx/write.ts`) salen de la MISMA vista (`lib/reportes/vista.ts`): un cambio de filas o columnas va en la vista, no en uno solo de los dos.
- Ventas: Impacto = Neto $ (el `impacto` de `evaluar` es solo de Compras). Una categoría efectiva vacía o que no es de Ingreso/Gasto va a «Sin categoría (revisar CONTROL)»; una UN o un proyecto que no existe va a «Sin unidad de negocio» / «Sin proyecto» (los totales cierran siempre).
- Tipos de operación por nombre exacto (`TIPOS_OPERACION` en `lib/tipos-operacion.ts`): Socios exige «Retiro de socio», «Gasto particular de socio» y «Aporte de socio» (si falta → error en pantalla); Saldos usa «Cobro a cliente» y «Pago a proveedor» (si falta uno, su tabla —Clientes con «Ventas sin cliente identificado», o Proveedores— se reemplaza por el error en pantalla y en el Excel; Cuentas se muestra siempre).
- Tipos de operación por nombre (CC-F4-02): los 6 nombres que la app busca (la transferencia + los 5 de los reportes) viven **solo** en `TIPOS_OPERACION` (`lib/tipos-operacion.ts`); Tesorería, Reportes y Maestros leen de ahí, y `test/tipos-operacion.test.ts` falla si alguno aparece como literal en `lib/` o `app/` fuera de esa constante (tests excluidos). En Maestros › Tipos de operación (`MaestroSpec.protegido`, por nombre exacto) esos 6 no se renombran ni se borran (409, servidor) y ningún otro registro puede tomar esos nombres. Campos bloqueados: los 5 de los reportes, Nombre / Movimiento / Es de socio (Suma a resultados, Categoría por defecto y Pide cliente/proveedor siguen editables); la transferencia, Nombre / Movimiento / Suma a resultados / Es de socio. El formulario deshabilita esos campos, muestra el aviso y no ofrece Borrar. Copy (`TIPO_PROTEGIDO_MESSAGES`): edición «Este tipo de operación lo usan los reportes: no se puede renombrar ni borrar, ni cambiar su Movimiento ni Es de socio.»; borrado «Este tipo de operación lo usan los reportes: no se puede renombrar ni borrar.» **Renombrar uno exige un prompt que cambie la constante y el registro de Airtable juntos.**
- Período de los reportes: años 2000–2099; el mes inicial (`?desde` o el Parámetro) va de 2000-01 a 2099-01 (`isMes`). Fuera de rango: `?desde` → 400; el Parámetro → enero del año actual con aviso.
- `Cache-Control: no-store`: solo con `withNoStore` (`lib/auth/api.ts`). Los 401/403 de `adminRoute`/`userRoute` lo llevan siempre; una ruta que no se debe cachear nunca pasa `{ noStore: true }` (todas las respuestas, también 400/404/500), como las de reportes.
- `lib/xlsx/write.ts`: escritor propio (ZIP con `node:zlib`, `server-only`), una hoja, números siempre numéricos con estilo. Todo texto pasa por `xmlSafe` (saca lo que XML 1.0 no admite: controles C0 salvo tab/LF/CR, U+FFFE/U+FFFF, surrogates sueltos). Los tests lo leen con `lib/xlsx/read.ts`.
- `parseNumberInput` rechaza más de 15 dígitos significativos (`MAX_INPUT_DIGITS`), con el mensaje de siempre.

## Proforma de horas (CC-F3-07)

- Lógica pura en `lib/proforma/proforma.ts` (`calcularProforma`, `parseAlicuota`, `isMesProforma`, `mesEfectivo`): `recordHours`/`sumHours` para las horas y `toCents` por registro (el importe del proyecto es la suma de los importes por registro, no horas totales × valor hora). Solo lectura: nunca escribe en Airtable.
- Servidor: `lib/proforma/server/service.ts` (`cargarProforma`, `clientesActivos`, `horasDelMesFormula`). Horas candidatas en Airtable por mes con los helpers de `formula.ts` (Mes a facturar en el mes, o vacío y Fecha en el mes); cliente y Facturable se filtran en código. Rutas `GET /api/admin/proforma` y `/pdf` con `adminRoute(..., { noStore: true })`; página `/reportes/proforma` (`<Guarded admin>`).
- Estados: mes inválido, cliente mal formado, Inactivo o sin cliente → 400; cliente inexistente → 404; alícuota inválida → 409 (bloquea pantalla y PDF); PDF de un mes sin horas → 404.
- PDF: `lib/proforma/pdf.ts` con `pdf-lib` + `@pdf-lib/fontkit` (MIT, JS puro). Fuente Sora embebida (OFL; `assets/fonts/sora`, con su licencia) y logo recortado `assets/brand/logo-kairos-pdf.png` (claro → banda negra). `next.config.ts` suma esos archivos al trace de `/api/admin/proforma/pdf` (`outputFileTracingIncludes`); si se mueven, actualizar ahí y en `lib/proforma/server/assets.ts`.
- Tests del PDF: se extrae el texto con `pdfjs-dist` (solo desarrollo, `test/pdf-text.ts`).

## Rol Cliente (CC-F4-01)

- Tercer rol de Usuarios.Rol (opción «Cliente» agregada con un write con typecast en CC-F4-01; `ROLES`, `HOME_BY_ROLE.Cliente = /cliente/horas`). Mismo login que todos.
- Deny by default: `requireUser` (páginas internas y `userRoute`, o sea `app/api/me/**`) acepta solo Admin y Empleado; `requireAdmin` solo Admin; `requireCliente` / `clienteRoute` solo Cliente; `requireSession` cualquier rol, solo para `/cambiar-password` y su API. API → 403; página → el inicio del rol. `test/cliente.test.ts` enumera TODAS las rutas de `app/api/**` y exige 403 para un Cliente fuera de `app/api/auth/**` y `app/api/cliente/**`; `test/route-guards.test.ts` exige `clienteRoute` en `app/api/cliente/**`.
- Vista Cliente (`/cliente/horas`, `<Guarded cliente>`): alcance = Proyectos asignados leídos de Airtable en cada request; solo horas Facturables. Dashboard con la agregación compartida `lib/horas/dashboard.ts` y las piezas `components/horas/dashboard-parts.tsx` (las mismas del Admin). Importes con las reglas de la Proforma (`importeRegistro`, `ivaDe`, `totalesPorMoneda` en `lib/proforma/proforma.ts`) en `lib/cliente/importes.ts`. Un proyecto pedido que no está asignado → 403 (la página muestra el aviso y la vista de sus proyectos).
- Respuestas a un Cliente: DTOs armados campo por campo con lista de claves permitidas (`CLIENTE_RESPONSE_KEYS`, lib/cliente/types.ts); el test falla si aparece otra.
- Pantalla y Excel salen de los mismos datos (`ClienteHorasData` → `lib/cliente/vista.ts` → `vistaToSheet`). Rutas con `{ noStore: true }`.
- Usuarios Cliente: un usuario con Horas (Colaborador o Cargado por, por los links inversos) no puede pasar a Cliente (409 en Rol + verificación posterior `clienteSinHoras`). ≥ 1 proyecto; los nuevos, Activos de clientes Activos y con valor hora y moneda; todos del mismo Cliente; sin Socio; Sigla opcional. Pre-validación + verificación posterior `clienteProyectos` (fail-closed), también al activar un Cliente.
- Proyectos asignados a un Cliente Activo: no se pueden dejar sin valor hora ni moneda ni cambiar de Cliente (antes y después de escribir). Un Cliente nunca es Colaborador de Horas (selector, filtros y servidor).
- `ROL_CLIENTE` (lib/roles.ts) en código que compara Rol en la misma línea que un Estado (test de literales viejos de Clientes › Estado).
- Página no encontrada: `app/not-found.tsx` (`components/shell/not-found-view.tsx`): mensaje neutro y «Volver al inicio» al inicio del rol (sin sesión, /login); no muestra la URL.
- IVA por moneda: se usa la fórmula de la Proforma (round2(Σ Neto × alícuota)); puede diferir ±0,01 de la suma de los IVA por proyecto. Decidido por Luciano (F4-01); no es un pendiente.
