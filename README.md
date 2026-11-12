# Agencia Kairos · App interna

App interna de Agencia Kairos. Next.js (App Router) + TypeScript + Tailwind CSS, con Airtable como base de datos. Se deploya en Vercel.

> Estado: **Fase 1 · CC-F1-01 (scaffold y base técnica)**. Todavía no hay login, usuarios, maestros, horas ni dashboard: las pantallas muestran "En construcción".

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

En desarrollo, `/` muestra una vista previa de los menús de cada rol (Admin y Empleado). Es temporal y se elimina cuando llegue el login (CC-F1-02).

## Variables de entorno

Todas son **solo del servidor** (ninguna lleva `NEXT_PUBLIC_`) y son obligatorias en runtime. `next build` no falla si faltan: se validan recién cuando se usan (`lib/env.ts`), con un mensaje que dice cuál falta.

| Variable           | Descripción                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `AIRTABLE_TOKEN`   | Token personal de Airtable con acceso de lectura/escritura a la base. |
| `AIRTABLE_BASE_ID` | ID de la base de Airtable (empieza con `app`).                     |
| `SESSION_SECRET`   | Secreto para firmar sesiones (mínimo 32 caracteres).               |

Para generar `SESSION_SECRET`:

```bash
openssl rand -base64 32
```

**En Vercel, las variables las carga Luciano** en la configuración del proyecto (Production y Preview). No se suben al repo: `.env.example` va sin valores y `.env*` está en `.gitignore`.

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

Antes de abrir un PR tienen que pasar: `lint`, `build`, `test` y `check:bundle`. GitHub Actions los corre en cada PR (`.github/workflows/ci.yml`).

## Estructura

```
app/
  (admin)/         rutas del rol Admin (dashboard, horas, usuarios, maestros/*)
  (empleado)/      rutas del rol Empleado (mis-horas)
  layout.tsx       layout raíz (fuente Sora, es-AR)
  globals.css      design tokens
components/
  ui/              componentes base (Button, Input, Select, Checkbox, Card, Table, FormField, Toast, InlineMessage)
  shell/           shell de la app (sidebar, drawer mobile, logo, menú por rol)
lib/
  airtable/        acceso a Airtable (solo servidor)
    schema.ts      IDs de tablas y campos: fuente única de verdad
    client.ts      cliente REST tipado (paginación, lotes, throttle, reintentos)
    formula.ts     helpers seguros para filterByFormula
    access.ts      qué campos puede ver cada rol
    errors.ts      AirtableError
  env.ts           validación de variables de entorno (solo servidor)
  format.ts        formatos es-AR (fechas, números, duraciones, porcentajes)
scripts/
  check-bundle.mjs verificación de secretos en el bundle
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
