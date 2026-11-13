# Agencia Kairos · App interna

App interna de Agencia Kairos. Next.js (App Router) + TypeScript + Tailwind CSS, con Airtable como base de datos. Se deploya en Vercel.

> Estado: **Fase 2 · CC-F2-04 (Tesorería)**. Fase 1 completa: login, guards por rol, ABM de Usuarios y Maestros, carga de horas del Empleado, Horas y Dashboard de Admin. Fase 2: Clientes Activo / Inactivo (CC-F2-01).

## Requisitos

- Node.js 22.22.2 o superior dentro de la línea 22 (o 24.15+, o 26+). Lo fija `jsdom` (dev), que es la dependencia con el mínimo más alto. Está en `.nvmrc` y en `engines` de `package.json`; CI usa `.nvmrc`.
- npm

## Setup

```bash
git clone https://github.com/lucianocribeiro/agencia-kairos-app.git
cd agencia-kairos-app
npm install
cp .env.example .env.local   # y completá los valores
npm run dev                  # http://localhost:3000
```

`/` redirige según la sesión: a `/login`, a `/cambiar-password` si hay que cambiar la contraseña, o al inicio del rol (`/dashboard` para Admin, `/mis-horas` para Empleado).

> En desarrollo, Next 16 valida la "navegación instantánea" de cada página y muestra un aviso en el overlay ("Could not validate `instant`…") cuando un guard redirige a propósito (por ejemplo, a `/cambiar-password`). Es esperado, solo pasa en `next dev` y no afecta el build.

## Variables de entorno

Todas son **solo del servidor** (ninguna lleva `NEXT_PUBLIC_`) y son obligatorias en runtime. `next build` no falla si faltan: se validan recién cuando se usan (`lib/env.ts`), con un mensaje que dice cuál falta.

| Variable           | Descripción                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `AIRTABLE_TOKEN`   | Token personal de Airtable con acceso de lectura/escritura a la base. |
| `AIRTABLE_BASE_ID` | ID de la base de Airtable (empieza con `app`).                     |
| `SESSION_SECRET`   | Secreto para firmar sesiones (mínimo 32 caracteres).               |
| `BOOTSTRAP_ADMIN_PASSWORD` | **Solo local.** Contraseña inicial del primer Admin (`npm run bootstrap:admin`). Nunca se carga en Vercel. |

Para generar `SESSION_SECRET`:

```bash
openssl rand -base64 32
```

**En Vercel, las variables las carga Luciano** en la configuración del proyecto (Production y Preview): `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID` y `SESSION_SECRET`. `BOOTSTRAP_ADMIN_PASSWORD` no va en Vercel.

El token de Airtable necesita `data.records:read` y `data.records:write`; para correr `npm run setup:intentos-login` también `schema.bases:read` y `schema.bases:write`. No se suben al repo: `.env.example` va sin valores y `.env*` está en `.gitignore`.

## Scripts

| Script                  | Qué hace                                                                 |
| ----------------------- | ------------------------------------------------------------------------ |
| `npm run dev`           | Servidor de desarrollo.                                                  |
| `npm run build`         | Build de producción.                                                     |
| `npm start`             | Sirve el build de producción.                                            |
| `npm run lint`          | ESLint.                                                                  |
| `npm run typecheck`     | Chequeo de tipos con TypeScript.                                         |
| `npm test`              | Tests unitarios (Vitest).                                                |
| `npm run check:bundle`  | Después del build, busca en `.next/static` los nombres y valores de los secretos. Falla si aparece alguno. |
| `npm run setup:intentos-login` | Verifica la tabla "Intentos de login" contra `lib/airtable/schema.ts` (tipos e IDs); si no existe, la crea, muestra los IDs nuevos y sale con error hasta que actualices `schema.ts`. Con `-- --verify` solo lee. |
| `npm run migrate:clientes-estado` | Migra Clientes Estado a Activo / Inactivo (ver «Migración de Clientes»). Dry-run por defecto; `-- --apply` escribe. |
| `npm run bootstrap:admin` | **Solo local.** Crea el primer Admin si no existe (ver abajo). |

Antes de abrir un PR tienen que pasar: `lint`, `build`, `test` y `check:bundle`. GitHub Actions los corre en cada PR (`.github/workflows/ci.yml`).

## Autenticación

- **Login** (`/login` → `POST /api/auth/login`): email, contraseña y la casilla «No soy un robot». Contraseñas con bcrypt (costo 12). Una contraseña de más de 72 bytes cuenta como intento fallido (nunca se trunca).
- **IP del cliente** (para el bloqueo por IP): `x-vercel-forwarded-for` (la fuente que documenta Vercel: [request headers](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for)), si no `x-real-ip`, si no el primer valor de `x-forwarded-for`, si no "desconocida".
- **Bloqueo temporal** (tabla "Intentos de login"): 5 fallidos por email en 15 minutos (contando solo los posteriores al último ingreso exitoso) o 20 fallidos por IP en 15 minutos → 429 durante 15 minutos. Si no se puede leer la tabla, el login falla cerrado (503).
- **Sesión**: cookie `kairos_session` httpOnly, `Secure` en producción, `SameSite=Lax`, 12 h sin renovación. Es un JWT HS256 (jose) con el ID del usuario, la fecha de emisión y una huella del hash de la contraseña: si la contraseña cambia, las sesiones viejas dejan de valer. En cada request se vuelve a leer el usuario (caché de 30 s por instancia): la sesión se invalida si el usuario no existe, está Inactivo o cambió la contraseña.
- **Contraseñas nuevas**: mínimo 10 caracteres y máximo 72 bytes UTF-8 (los caracteres con tilde ocupan 2 bytes, los emojis 4). Las reglas están en `lib/auth/password-policy.ts` (las usa también el formulario) y todo hash sale de `hashNewPassword()` en `lib/auth/password-hash.ts`.
- **Cambiar contraseña** (`/cambiar-password` → `POST /api/auth/password`): distinta de la actual. Usa el mismo bloqueo que el login (mismo contador por email e IP): una contraseña actual incorrecta cuenta como Fallido. Un cambio exitoso registra Exitoso (reinicia el contador). Si el usuario tiene «Debe cambiar password», no puede usar nada más hasta cambiarla.
- **Cerrar sesión**: `POST /api/auth/logout` con body JSON (415 si no es JSON, para que un formulario de otro sitio no pueda cerrar la sesión). El botón del header lo llama con `fetch` y navega a `/login` solo si la respuesta es 2xx; si falla, se queda en la página y muestra «No pudimos cerrar la sesión. Probá de nuevo.». Login y cambio de contraseña también exigen JSON.
- **Guards** (`lib/auth/guards.ts`): `requireUser()` y `requireAdmin()`. En páginas redirigen (sin sesión → `/login`; Empleado en página de Admin → `/mis-horas`); en APIs responden 401/403 en JSON.
- **`proxy.ts`** (la interceptación de Next 16, ex `middleware.ts`): solo redirige a `/login` si la cookie falta o su firma no es válida. La autorización real siempre la hacen los guards.

### Convención para el resto de Fase 1

- **Toda mutación pasa por un Route Handler**, con los wrappers de `lib/auth/api.ts`.
- **Endpoints de Admin** en `app/api/admin/**`: cada método es `export const GET = adminRoute(async (request, user) => { ... })` (igual POST/PUT/PATCH/DELETE). `adminRoute` corre `requireAdmin()` antes del handler.
- **Endpoints de Empleado** en `app/api/me/**`: `export const GET = userRoute(...)`, que corre `requireUser()`.
- Un test por AST (`test/route-guards.test.ts`) falla si algún método exportado en esas carpetas no está envuelto, o si se declara como `export async function GET`.
- **Respuestas a un Empleado**: pasan por el recorte por rol de `lib/airtable/access.ts`.
- **Páginas protegidas**: envuelven su contenido en `<Guarded>` o `<Guarded admin>`.

### Primer Admin (bootstrap, solo local)

```bash
# en .env.local: AIRTABLE_TOKEN, AIRTABLE_BASE_ID y BOOTSTRAP_ADMIN_PASSWORD (mínimo 10 caracteres)
npm run bootstrap:admin
```

Antes de tocar nada, rechaza `BOOTSTRAP_ADMIN_PASSWORD` si tiene menos de 10 caracteres o más de 72 bytes, y verifica que los IDs de Usuarios de la base coincidan con `lib/airtable/schema.ts`. Si ya existe un usuario con `luciano@agenciakairos.net` (sin importar mayúsculas), no cambia nada. Si no, lo crea como Admin Activo, sigla LR, con «Debe cambiar password» = sí. No imprime la contraseña ni el hash. `BOOTSTRAP_ADMIN_PASSWORD` nunca se configura en Vercel.

## Usuarios y Maestros (Admin)

- **Usuarios** (`/usuarios`): lista con filtros por Rol y Estado y búsqueda; alta con contraseña temporal (se tipea o se genera, 14 caracteres) y «Debe cambiar password» = sí; edición; activar/desactivar; reset de contraseña. No se borran. Un Admin no puede desactivarse ni cambiarse el rol a sí mismo, y siempre tiene que quedar al menos un Admin activo.
- **Maestros** (`/maestros/*`): un ABM único configurado por tabla (`lib/abm/maestros.ts` + `lib/abm/server/maestros-config.ts`). Lista con búsqueda, orden por el campo principal y filtro por Estado donde existe; alta, edición y borrado solo si la tabla lo permite y el registro no tiene registros asociados (si los tiene: 409). Proyectos no se borran: se usa Estado. Clientes se borran solo sin proyectos, ventas ni movimientos de Tesorería; si no, el 409 dice qué y cuántos y sugiere pasarlo a Inactivo.
- **Clientes** (Fase 2): Estado Activo / Inactivo (la lista arranca en Activos; el filtro permite Inactivos y Todos). Sigla obligatoria y única para todo cliente (2 letras, en mayúsculas). Solo los Activos se pueden elegir en Proyectos y en el filtro de clientes de Horas.
- **Reglas destacadas**: el Código de un proyecto es `Sigla del cliente - Nombre corto` y lo arma el servidor; cambiar la sigla de un cliente recalcula los Códigos de sus proyectos (si alguno choca, se rechaza el cambio entero; si una escritura falla a mitad de camino, se revierte todo). CUIT validado con dígito verificador y guardado solo con dígitos. Números en formato es-AR (`1.234,56`; también `1234,56` y `1234.56`).
- **API**: `app/api/admin/usuarios/**` y `app/api/admin/maestros/[tabla]/**`, todo con `adminRoute`. Errores: 400 validación, 409 duplicado/choque, 404 no encontrado, 503 Airtable no disponible (o cascada revertida).
- **Concurrencia**: sin transacciones; las reglas de unicidad y «al menos un Admin activo» se verifican también después de escribir y se compensan; si esa verificación no se puede leer, el cambio se deshace (503). Detalle y riesgo residual en `AGENTS.md`.

## Horas, Mis horas y Dashboard

- **Mis horas** (`/mis-horas`, Empleado): carga arriba (Fecha hasta hoy en Buenos Aires, Proyecto asignado y Activo, Tarea, Desde, Hasta, con las horas en vivo) y lista propia abajo con período (mes actual / anterior), proyecto y total. Sin edición ni borrado: `/api/me/horas` solo tiene GET y POST.
- **Horas** (`/horas`, Admin): lista con filtros por colaborador, proyecto, cliente y período, total, alta (cualquier fecha y proyecto, también Cerrados), edición (Cargado por no cambia) y borrado.
- **Dashboard** (`/dashboard`, Admin): horas por proyecto × período (diaria, semanal ISO o mensual) con totales y un gráfico de barras en SVG. Solo horas, nunca importes.
- **Reglas**: horas = `ROUND((hasta − desde) / 3600, 2)` en una sola función (`recordHours`, `lib/horas/time.ts`) que usan listas, totales y dashboard; dos registros del mismo colaborador y día no se pueden pisar (los que se tocan sí), con verificación posterior.
- **Fórmula de Airtable**: desde CC-F2-01 el campo Horas usa `IF(AND(LEN({desde} & "") > 0, LEN({hasta} & "") > 0), ROUND(({hasta} − {desde}) / 3600, 2))`, así que un registro que empieza a las 00:00 (0 segundos) ya no queda en blanco y coincide con `recordHours`. La app sigue sin leer ese campo.
- **Un Empleado nunca ve** valor hora, moneda, importe ni cliente: no se leen de Airtable y las respuestas son DTOs armados a mano (`test/horas.test.ts`, criterio 7).

## Migración de Clientes (Fase 2)

`npm run migrate:clientes-estado` (dry-run) y `npm run migrate:clientes-estado -- --apply`.

- Primera corrida: aborta sin escribir salvo que la tabla tenga exactamente 16 registros (9 «Cliente» + 7 «Lead»), los 7 leads previstos estén presentes, en Lead y sin links en Proyectos, Ventas ni Tesorería, y existan las opciones Activo e Inactivo.
- `--apply` guarda antes de la primera escritura `backups/migrate-clientes-estado.resume.json` (snapshot original + plan, modo 0600). Si una corrida se corta a mitad de camino, la siguiente lo usa: solo acepta leads faltantes si están en ese plan. No borres ese archivo hasta que la migración termine bien.
- Verificación final: exactamente 9 registros, los 9 del plan, todos Activo, ninguno con una opción vieja.
- Todo lo de `backups/` está gitignored (tiene datos reales).

### Orden de despliegue (hecho)

1. ✔ Opciones Activo e Inactivo agregadas en la interfaz (2026-11-12).
2. ✔ Merge y deploy de PR #6 (2026-11-13, a55bfaa).
3. ✔ `npm run migrate:clientes-estado` (dry-run) y `-- --apply` (2026-11-13): 9 clientes Activo, 7 leads borrados.
4. ✔ Opciones viejas quitadas en la interfaz (Luciano).
5. ✔ Limpieza del código de compatibilidad (CC-F2-02): solo `Activo` cuenta como activo. El script de migración y sus tests se conservan.

## Importación ARCA (Ventas y Compras)

**Ventas › Importar** (`/ventas/importar`) y **Compras › Importar** (`/compras/importar`), solo Admin. Se sube el .xlsx que exporta ARCA («Mis Comprobantes Emitidos» para Ventas, «Recibidos» para Compras).

1. **Vista previa**: el servidor lee el archivo (busca la fila de encabezados por nombre, aunque haya un título arriba; tolera mayúsculas, tildes, espacios y saltos de línea), calcula todo y no escribe nada. Cada fila queda **Nueva**, **Ya importada** (la Clave ARCA ya está en la tabla), **Duplicada en el archivo** o **Con error** (con el motivo). Antes de confirmar se pueden editar Mes devengado, Proyecto (solo Activos), Unidad de negocio, Categoría (de ingreso en Ventas, de gasto en Compras), Observaciones y, en Compras, Imputar a socio; al cambiar el proyecto se recalculan Cliente, UN y Control.
2. **Confirmar**: sin estado. El navegador vuelve a mandar el archivo y las ediciones (por Clave ARCA); el servidor vuelve a leer y validar todo, y escribe solo las filas nuevas.
3. **Informe**: importadas, omitidas por duplicado (ya importadas + duplicadas en el archivo + importadas en paralelo), con error (con motivo) y proveedores creados.

Reglas (de `Gestion_Kairos_ERP_v4.xlsx`, implementadas en `lib/ventas-compras/`, no leídas de las fórmulas de Airtable):

- **Clave ARCA**: `Código|Punto de venta|Número desde|Documento`. Código = texto del Tipo hasta el primer espacio («11 - Factura C» → `11`); punto de venta y número como enteros sin ceros a la izquierda; documento solo con dígitos (tal cual, sin sacar ceros). Ventas usa el Nro. Doc. Receptor; Compras, el Nro. Doc. Emisor. Ejemplo: `11|2|1234|20123456786`.
- **Fecha**: número de serie de Excel (sistema 1900: 1 = 01/01/1900, 59 = 28/02/1900, 60 = el 29/02/1900 que no existió → «Fecha inválida», 61 = 01/03/1900) o texto DD/MM/AAAA.
- **Signo** por Código en Tipos de comprobante; si no está → «Tipo de comprobante no reconocido» (no se importa). **TC** = Tipo Cambio si es > 0, si no 1. Moneda en pesos: «$», «PES» o vacío; otra moneda sin tipo de cambio > 0 → «Moneda extranjera sin tipo de cambio» (no se importa).
- **Importes**: Total $ = ROUND(Imp. Total × TC; 2) × Signo; IVA $ = ROUND(Total IVA × TC; 2) × Signo; Neto $ = Total $ − IVA $ − ROUND(Otros Tributos × TC; 2) × Signo. Vacíos = 0. Redondeo como ROUND de Excel: mitad lejos del cero sobre 15 dígitos significativos (1,005 → 1,01; 2,675 → 2,68), en centavos enteros (`lib/ventas-compras/money.ts`).
- **Ventas**: Cliente del proyecto; sin proyecto, por CUIT del receptor contra Clientes › CUIT (11 dígitos). Categoría por defecto = Parámetro «Categoría por defecto en Ventas» (no se escribe); UN por defecto = la del proyecto (no se escribe).
- **Compras**: Proveedor por CUIT del emisor; si no existe se crea (Nombre = Denominación Emisor). CUIT inválido → «CUIT del emisor inválido» (no se importa). Categoría = la por defecto del proveedor (se escribe). Impacto en resultados = −Neto $ sin socio; a cuenta del socio = Neto $ con socio.
- **Control** (primer mensaje que falla, mismo orden que la columna CONTROL del Excel). Ventas: tipo no reconocido → categoría inexistente → no es de ingreso → proyecto inexistente → falta proyecto → cliente sin identificar → OK. Compras: tipo no reconocido → socio inexistente → falta categoría (sin socio) → categoría inexistente → no es de gasto → proyecto inexistente → falta proyecto (sin socio) → OK. Un Control distinto de OK no impide importar.

**Límites (Vercel)**: el body de una función no puede pasar 4,5 MB y la duración máxima en Hobby es 300 s (https://vercel.com/docs/functions/limitations). Por eso el archivo se limita a 4 MB (se avisa en el navegador antes de subir y el servidor responde 413) y a 1.000 comprobantes por importación; con el throttle de Airtable (5 pedidos/s, lotes de 10) 1.000 filas tardan unos 30 s.

**Escritura**: lotes de 10, los create nunca se reintentan, con compensación: si algo falla a mitad de camino se borra todo lo que escribió esta importación (también los proveedores creados) → 503 (500 si el rollback falla). Después se verifica (fail-closed) que ningún proveedor creado choque con otro creado en paralelo (si choca, se deshace todo → 409) y que cada Clave ARCA esté una sola vez: si otra importación en paralelo guardó la misma clave primero, se borran las filas propias repetidas y se informan como «importadas en paralelo».

## Ventas y Compras: listas, edición y borrado

**Ventas › Comprobantes** (`/ventas`) y **Compras › Comprobantes** (`/compras`), solo Admin.

- **Columnas**: Fecha, Tipo, PV-Número, Cliente / Proveedor, Denominación, Moneda, Total $, IVA $, Neto $ (Compras también Impacto en resultados $ y A cuenta del socio $), Mes devengado, Proyecto, UN, Categoría y Control. Los importes se calculan en código con las mismas reglas que la importación (`lib/ventas-compras/listado.ts` usa `evaluar` y `calcularImportes`); nunca se leen las fórmulas de Airtable.
- **Valores efectivos** (igual que en la importación): Mes devengado vacío → mes de la Fecha; UN vacía → la del proyecto; Categoría vacía → Ventas: Parámetro «Categoría por defecto en Ventas»; Compras: la Categoría por defecto del proveedor.
- **Cliente efectivo (Ventas)**: el del proyecto si hay proyecto; si no, el cliente (Activo o Inactivo) cuyo CUIT coincide con el Nro. Doc. Receptor (solo si hay exactamente uno: si dos clientes tienen el mismo CUIT es ambiguo y cuenta como sin match); si no, ninguno («Cliente sin identificar»). El CUIT de Clientes es opcional pero, si se carga, se valida (dígito verificador), se guarda con 11 dígitos y es único, como en Proveedores. Se calcula al leer, como en el Excel: si después se carga el CUIT en Clientes, las filas viejas se arreglan solas. El link Cliente guardado en Airtable se actualiza cada vez que se guarda la fila. **Los reportes tienen que usar el Cliente efectivo, no el link guardado.**
- **Control**: los mismos mensajes y el mismo orden que la importación. Las filas con observaciones se ven atenuadas.
- **Filtros**: Fecha (por defecto el año actual), Mes devengado efectivo, Cliente / Proveedor, Proyecto (incluye «Sin proyecto»), Categoría efectiva y Control (OK, con observaciones o un mensaje puntual). La Fecha se filtra en Airtable; el resto, en código. Los **totales** (Total $, IVA $, Neto $; Compras también Impacto y A cuenta del socio) son de todo el conjunto filtrado, no solo de la página (50 filas por página). **Límite**: si el rango de Fechas tiene más de 5.000 comprobantes, la lista responde «El período tiene más de 5.000 comprobantes. Elegí un rango de fechas más corto.» (sin calcular totales).
- **Edición**: Mes devengado, Proyecto, Unidad de negocio, Categoría, Observaciones y, en Compras, Imputar a socio. Las columnas ARCA son de solo lectura. Mismas validaciones que la importación (se puede mantener el proyecto linkeado aunque ya no esté Activo). Vaciar un campo vuelve al valor por defecto. Se escribe solo lo que se cambió (más, en Ventas, el link Cliente).
- **Borrado**: un comprobante por vez, con confirmación (Clave ARCA, Fecha, Denominación, Total $). El proveedor creado por una importación queda. Si se vuelve a importar el mismo archivo, la fila borrada vuelve como **Nueva** y se importa de nuevo.

## Tesorería

**Tesorería** (`/tesoreria`), solo Admin. Un registro por movimiento: Importe siempre positivo en la moneda de la cuenta y Movimiento (Cobranza entra, Pago sale). Reglas en `lib/tesoreria/rules.ts` (las mismas para el formulario, el Control y la lista; no se leen las fórmulas de Airtable).

- **Importes**: con signo = +Importe en una cobranza, −Importe en un pago. TC aplicado: cuenta ARS → 1; cuenta USD → el Tipo de cambio (obligatorio, > 0, hasta 4 decimales). Importe $ = ROUND(con signo × TC; 2) (ROUND de Excel).
- **Efectivos**: Es de socio = el del tipo. Suma a resultados: de socio → N; si no, la del registro; si no, la del tipo. Categoría (solo si suma S): la del registro; si no, la por defecto del tipo. Impacto en resultados $ = Importe $ si suma S; a cuenta del socio $ = −Importe $ si es de socio.
- **Control** (primer mensaje que falla, orden del Excel): [solo patas de transferencia] Transferencia incompleta → Transferencia inconsistente → Falta cuenta → Cuenta inexistente → Indicá Cobranza o Pago → Falta importe (positivo) → Falta tipo de operación → Tipo de operación inexistente → Este tipo debería ser Cobranza/Pago → Falta cliente / proveedor → Falta socio → Socio sólo en retiros, aportes o gastos particulares → Socio inexistente → Falta categoría → Categoría inexistente → Falta tipo de cambio → OK. **No se puede guardar un movimiento cuyo Control no sea OK.**
- **Formulario de movimientos**: tercero = Cliente en una cobranza (cualquier Estado) y Proveedor en un pago; obligatorio si el tipo lo pide; nunca los dos. Socio solo si el tipo es de socio. El tipo «Transferencia entre cuentas propias» no se puede usar acá.
- **Transferencia entre cuentas propias** (su propio formulario): cuenta origen y destino distintas y de la misma moneda («Las cuentas tienen que ser de la misma moneda.»), importe, fecha, TC si es USD (el mismo en los 2 registros). Crea 2 registros (Pago en origen, Cobranza en destino; Suma N) con el mismo ID nuevo en el campo «Transferencia», en un solo pedido. Se crean, editan y borran juntos, y todo se reconcilia por ese ID: después de cualquier error la app relee los registros con el ID y deja la base sin ninguno o con el par completo y correcto (si no lo puede confirmar responde «El cambio quedó incompleto…»). No impacta en resultados y en pesos suma 0 entre las dos cuentas.
- **Transferencia incompleta**: si un ID de transferencia no lo comparten exactamente un Pago y una Cobranza (p. ej. después de una falla de Airtable), esos registros muestran el Control «Transferencia incompleta». Se arregla borrando la transferencia (borra todos los registros con ese ID) y cargándola de nuevo.
- **Transferencia inconsistente**: un par completo (un Pago y una Cobranza) cuyas patas tienen distinta fecha, importe, tipo de cambio o descripción, o cuentas de distinta moneda (p. ej. si dos personas la editaron a la vez). Se arregla editándola desde el formulario de transferencia (reescribe las 2 patas) o borrándola.
- **Tipo protegido**: el tipo de operación «Transferencia entre cuentas propias» no se puede renombrar, borrar ni cambiar su Movimiento, Suma a resultados o Es de socio (Maestros responde 409), y ningún otro tipo puede tomar ese nombre.
- **Moneda de una cuenta**: nunca se convierte. Si la cuenta ya tiene movimientos en Tesorería, Maestros › Cuentas no deja cambiar la Moneda («Esta cuenta ya tiene movimientos en Tesorería: no se puede cambiar la moneda. Creá una cuenta nueva.»); hay que crear una cuenta nueva.
- **Fechas**: solo fechas reales (31/02, 29/02 de un año no bisiesto o mes 13 → «Ingresá una fecha válida.»).
- **Saldo** por cuenta = Saldo inicial (vacío = 0) + suma de los importes con signo de **todos** sus movimientos, en la moneda de la cuenta, ordenados por Fecha y después N° (regla del Excel). **La Fecha saldo inicial no se usa en el cálculo.** Con un filtro de Fecha, la primera fila ya incluye todo lo anterior; se muestran el saldo actual, el del inicio y el del final del período. Los filtros de tipo, movimiento y Control no cambian el saldo corrido de cada fila.
- **Totales** del conjunto filtrado: entradas, salidas y neto (moneda de la cuenta), Importe $, Impacto en resultados $ y A cuenta del socio $.
- **Límite**: si el rango de Fechas tiene más de 5.000 movimientos de la cuenta, la lista pide un rango más corto. La lista lee toda la tabla (el saldo necesita todos los movimientos anteriores).

## Estructura

```
app/
  (admin)/         rutas del rol Admin (dashboard, horas, usuarios, maestros/*)
  (empleado)/      rutas del rol Empleado (mis-horas)
  (auth)/          login y cambiar-password (sin sidebar)
  api/auth/        login, logout, password, expirada
  api/admin/       endpoints de Admin (requireAdmin)
  layout.tsx       layout raíz (fuente Sora, es-AR)
  globals.css      design tokens
components/
  ui/              componentes base (Button, Input, Select, Checkbox, Card, Table, FormField, Toast, InlineMessage)
  shell/           shell de la app (sidebar, drawer mobile, header, menú por rol)
  auth/            formularios de login y contraseña, <Guarded>
  abm/             tabla, formulario y gestores de Usuarios y Maestros
lib/
  airtable/        acceso a Airtable (solo servidor)
    schema.ts      IDs de tablas y campos: fuente única de verdad
    client.ts      cliente REST tipado (paginación, lotes, throttle, reintentos)
    formula.ts     helpers seguros para filterByFormula
    access.ts      qué campos puede ver cada rol
    errors.ts      AirtableError
  abm/             specs y validación de Usuarios y Maestros (client-safe); server/ con la parte de servidor
  auth/            sesión, guards, login, bloqueo, credenciales (solo servidor, salvo token/constants)
  cuit.ts          validación y formato de CUIT
  env.ts           validación de variables de entorno (solo servidor)
  format.ts        formatos es-AR (fechas, números, duraciones, porcentajes)
proxy.ts           interceptación de requests (Next 16)
scripts/
  check-bundle.mjs verificación de secretos en el bundle
  setup-intentos-login.mjs  crea/verifica la tabla "Intentos de login"
  bootstrap-admin.mjs       crea el primer Admin
```

## Reglas técnicas

- **Dependencias con versión exacta** en `package.json` (`.npmrc` con `save-exact=true`). Usá `npm ci` para instalar exactamente el lockfile.
- **Reintentos de Airtable**: las lecturas reintentan 429, 5xx y errores de red; `update` y `delete` reintentan 429 y 5xx; los `create` no se reintentan nunca, porque la documentación de Airtable ([rate limits](https://airtable.com/developers/web/api/rate-limits), [errores](https://airtable.com/developers/web/api/errors)) no garantiza que un 429 no se haya aplicado y un reintento podría duplicar registros.

- **Airtable solo desde el servidor.** Todo vive en `lib/airtable/` y cada archivo importa `server-only`: si un componente cliente lo importa, el build falla.
- **IDs, nunca nombres.** Tablas y campos se referencian por ID desde `lib/airtable/schema.ts`. Las lecturas usan `returnFieldsByFieldId` y piden solo los campos necesarios (`fields`). Las escrituras van por ID de campo.
- **Campos calculados y links inversos** (`COMPUTED_FIELDS`, `READ_ONLY_FIELDS`) no se escriben: el cliente lanza un error antes de llamar a la API.
- **Campos restringidos:** `RESTRICTED_FIELDS` nunca se devuelven a un Empleado; `Usuarios.passwordHash` no se devuelve a nadie.
- **UI en es-AR con voseo.** Fechas DD/MM/AAAA, números con `.` de miles y `,` decimal.
- **Sin azul.** La paleta por defecto de Tailwind está desactivada; solo existen los tokens de `app/globals.css`.

### Uso del cliente de Airtable

```ts
import "server-only";
import { getAirtableClient } from "@/lib/airtable/client";
import { and, eq } from "@/lib/airtable/formula";
import { TABLES } from "@/lib/airtable/schema";

const U = TABLES.usuarios.fields;
const usuarios = await getAirtableClient().list(TABLES.usuarios.id, {
  fields: [U.nombre, U.email, U.rol],
  filterByFormula: and(eq(U.estado, "Activo"), eq(U.email, emailIngresado)),
});
```
