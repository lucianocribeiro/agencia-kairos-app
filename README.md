# Agencia Kairos · App interna

App interna de Agencia Kairos. Next.js (App Router) + TypeScript + Tailwind CSS, con Airtable como base de datos. Se deploya en Vercel.

> Estado: **Fase 1 · CC-F1-02 (auth, sesión, bloqueo, primer Admin)**. Hay login, cambio de contraseña y guards por rol. Usuarios, maestros, horas y dashboard todavía muestran "En construcción".

## Requisitos

- Node.js 22 o superior
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
| `npm run setup:intentos-login` | Crea (o verifica, si ya existe) la tabla "Intentos de login" en Airtable. Idempotente. |
| `npm run bootstrap:admin` | **Solo local.** Crea el primer Admin si no existe (ver abajo). |

Antes de abrir un PR tienen que pasar: `lint`, `build`, `test` y `check:bundle`. GitHub Actions los corre en cada PR (`.github/workflows/ci.yml`).

## Autenticación

- **Login** (`/login` → `POST /api/auth/login`): email, contraseña y la casilla «No soy un robot». Contraseñas con bcrypt (costo 12).
- **Bloqueo temporal** (tabla "Intentos de login"): 5 fallidos por email en 15 minutos (contando solo los posteriores al último ingreso exitoso) o 20 fallidos por IP en 15 minutos → 429 durante 15 minutos. Si no se puede leer la tabla, el login falla cerrado (503).
- **Sesión**: cookie `kairos_session` httpOnly, `Secure` en producción, `SameSite=Lax`, 12 h sin renovación. Es un JWT HS256 (jose) con el ID del usuario, la fecha de emisión y una huella del hash de la contraseña: si la contraseña cambia, las sesiones viejas dejan de valer. En cada request se vuelve a leer el usuario (caché de 30 s por instancia): la sesión se invalida si el usuario no existe, está Inactivo o cambió la contraseña.
- **Cambiar contraseña** (`/cambiar-password` → `POST /api/auth/password`): mínimo 10 caracteres, distinta de la actual. Si el usuario tiene «Debe cambiar password», no puede usar nada más hasta cambiarla.
- **Cerrar sesión**: `POST /api/auth/logout`.
- **Guards** (`lib/auth/guards.ts`): `requireUser()` y `requireAdmin()`. En páginas redirigen (sin sesión → `/login`; Empleado en página de Admin → `/mis-horas`); en APIs responden 401/403 en JSON.
- **`proxy.ts`** (la interceptación de Next 16, ex `middleware.ts`): solo redirige a `/login` si la cookie falta o su firma no es válida. La autorización real siempre la hacen los guards.

### Convención para el resto de Fase 1

- **Toda mutación pasa por un Route Handler**, exportado con `apiRoute()` (`lib/auth/api.ts`).
- **Endpoints de Admin** en `app/api/admin/**`: lo primero es `await requireAdmin()`. Un test recorre esa carpeta y falla si alguna ruta no lo hace.
- **Endpoints de Empleado** en `app/api/me/**`: lo primero es `await requireUser()`.
- **Respuestas a un Empleado**: pasan por el recorte por rol de `lib/airtable/access.ts`.
- **Páginas protegidas**: envuelven su contenido en `<Guarded>` o `<Guarded admin>`.

### Primer Admin (bootstrap, solo local)

```bash
# en .env.local: AIRTABLE_TOKEN, AIRTABLE_BASE_ID y BOOTSTRAP_ADMIN_PASSWORD (mínimo 10 caracteres)
npm run bootstrap:admin
```

Si ya existe un usuario con `luciano@agenciakairos.net` (sin importar mayúsculas), no cambia nada. Si no, lo crea como Admin Activo, sigla LR, con «Debe cambiar password» = sí. No imprime la contraseña ni el hash. `BOOTSTRAP_ADMIN_PASSWORD` nunca se configura en Vercel.

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
lib/
  airtable/        acceso a Airtable (solo servidor)
    schema.ts      IDs de tablas y campos: fuente única de verdad
    client.ts      cliente REST tipado (paginación, lotes, throttle, reintentos)
    formula.ts     helpers seguros para filterByFormula
    access.ts      qué campos puede ver cada rol
    errors.ts      AirtableError
  auth/            sesión, guards, login, bloqueo, credenciales (solo servidor, salvo token/constants)
  env.ts           validación de variables de entorno (solo servidor)
  format.ts        formatos es-AR (fechas, números, duraciones, porcentajes)
proxy.ts           interceptación de requests (Next 16)
scripts/
  check-bundle.mjs verificación de secretos en el bundle
  setup-intentos-login.mjs  crea/verifica la tabla "Intentos de login"
  bootstrap-admin.mjs       crea el primer Admin
```

## Reglas técnicas

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
