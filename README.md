# Agencia Kairos · App interna

App interna de Agencia Kairos. Next.js (App Router) + TypeScript + Tailwind CSS, con Airtable como base de datos. Se deploya en Vercel.

> Estado: **Fase 1 · CC-F1-04 (Horas, Mis horas y Dashboard)**. Login, guards por rol, ABM de Usuarios y Maestros, carga de horas del Empleado, Horas y Dashboard de Admin.

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
- **Maestros** (`/maestros/*`): un ABM único configurado por tabla (`lib/abm/maestros.ts` + `lib/abm/server/maestros-config.ts`). Lista con búsqueda, orden por el campo principal y filtro por Estado donde existe; alta, edición y borrado solo si la tabla lo permite y el registro no tiene registros asociados (si los tiene: 409). Clientes y Proyectos no se borran: se usa Estado.
- **Reglas destacadas**: el Código de un proyecto es `Sigla del cliente - Nombre corto` y lo arma el servidor; cambiar la sigla de un cliente recalcula los Códigos de sus proyectos (si alguno choca, se rechaza el cambio entero; si una escritura falla a mitad de camino, se revierte todo). CUIT validado con dígito verificador y guardado solo con dígitos. Números en formato es-AR (`1.234,56`; también `1234,56` y `1234.56`).
- **API**: `app/api/admin/usuarios/**` y `app/api/admin/maestros/[tabla]/**`, todo con `adminRoute`. Errores: 400 validación, 409 duplicado/choque, 404 no encontrado, 503 Airtable no disponible (o cascada revertida).
- **Concurrencia**: sin transacciones; las reglas de unicidad y «al menos un Admin activo» se verifican también después de escribir y se compensan; si esa verificación no se puede leer, el cambio se deshace (503). Detalle y riesgo residual en `AGENTS.md`.

## Horas, Mis horas y Dashboard

- **Mis horas** (`/mis-horas`, Empleado): carga arriba (Fecha hasta hoy en Buenos Aires, Proyecto asignado y Activo, Tarea, Desde, Hasta, con las horas en vivo) y lista propia abajo con período (mes actual / anterior), proyecto y total. Sin edición ni borrado: `/api/me/horas` solo tiene GET y POST.
- **Horas** (`/horas`, Admin): lista con filtros por colaborador, proyecto, cliente y período, total, alta (cualquier fecha y proyecto, también Cerrados), edición (Cargado por no cambia) y borrado.
- **Dashboard** (`/dashboard`, Admin): horas por proyecto × período (diaria, semanal ISO o mensual) con totales y un gráfico de barras en SVG. Solo horas, nunca importes.
- **Reglas**: horas = `ROUND((hasta − desde) / 3600, 2)` en una sola función (`recordHours`, `lib/horas/time.ts`) que usan listas, totales y dashboard; dos registros del mismo colaborador y día no se pueden pisar (los que se tocan sí), con verificación posterior.
- **Diferencia con la fórmula de Airtable**: el campo Horas usa `IF(AND({desde}, {hasta}), …)`. Como 00:00 se guarda como 0, un registro que empieza a las 00:00 queda en blanco en Airtable; la app lo calcula igual. Para que coincidan siempre habría que cambiar la fórmula a `IF(AND({desde} != BLANK(), {hasta} != BLANK()), …)` (no se tocó la base).
- **Un Empleado nunca ve** valor hora, moneda, importe ni cliente: no se leen de Airtable y las respuestas son DTOs armados a mano (`test/horas.test.ts`, criterio 7).

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
