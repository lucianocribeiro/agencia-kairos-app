import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { isValidElement } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AirtableError, type AirtableErrorCode } from "@/lib/airtable/errors";
import { TABLES } from "@/lib/airtable/schema";
import { MAESTRO_SLUGS } from "@/lib/abm/maestros";
import { createFakeAirtable } from "./fake-airtable";

/**
 * Endurecimiento de /api/admin/** y de las páginas Admin (CC-F1-03 v2):
 * concurrencia en Usuarios (N-02), mapeo de errores de Airtable (N-05) y
 * tests negativos (N-06). Mismo armado que admin-routes.test.ts.
 */
const SECRET = "a".repeat(44);
const fake = createFakeAirtable();
const cookieJar = new Map<string, string>();

vi.mock("@/lib/airtable/client", () => ({ getAirtableClient: () => fake.client }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ SESSION_SECRET: SECRET, AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "appxGhn6qLbmWvMke" }),
}));

const { SESSION_COOKIE } = await import("@/lib/auth/constants");
const { signSessionToken } = await import("@/lib/auth/token");
const { passwordFingerprint } = await import("@/lib/auth/password-hash");
const { clearUserCache } = await import("@/lib/auth/user-cache");
const { API_MESSAGES } = await import("@/lib/auth/api");
const { createUsuario, setUsuarioActivo, updateUsuario } = await import("@/lib/abm/server/usuarios-service");

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ROUTES = import.meta.glob<Record<string, Handler>>("/app/api/admin/**/route.ts", { eager: true });
const route = (file: string) => ROUTES[`/app/api/admin/${file}`];

const U = TABLES.usuarios.fields;
const P = TABLES.proyectos;
const C = TABLES.clientes;
const UN = TABLES.unidadesNegocio;
const CAT = TABLES.categorias;
const VALID_CUIT = "20-12345678-6";

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("clave-de-prueba", 4);
});

let adminId: string;
let empleadoId: string;
beforeEach(() => {
  fake.reset();
  cookieJar.clear();
  clearUserCache();
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  adminId = seedUser({ nombre: "Ana Admin", email: "ana@kairos.test", rol: "Admin", sigla: "AA" });
  empleadoId = seedUser({ nombre: "Eva Empleada", email: "eva@kairos.test", rol: "Empleado", sigla: "EE" });
});

function seedUser(u: { nombre: string; email: string; rol: string; sigla: string; estado?: string }) {
  return fake.seed(TABLES.usuarios.id, {
    [U.nombre]: u.nombre,
    [U.email]: u.email,
    [U.rol]: u.rol,
    [U.sigla]: u.sigla,
    [U.estado]: u.estado ?? "Activo",
    [U.debeCambiarPassword]: false,
    [U.passwordHash]: hash,
  });
}

async function loginAs(userId: string) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}

async function call(file: string, method: string, body?: unknown, params: Record<string, string> = {}) {
  const cookie = cookieJar.get(SESSION_COOKIE);
  const req = new NextRequest("http://localhost/api/admin/x", {
    method,
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
  });
  const res = await route(file)[method](req, { params: Promise.resolve(params) });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

const writes = () => fake.calls.filter((c) => c.method === "create" || c.method === "update" || c.method === "delete");
const fieldsOf = (tableId: string, id: string) => fake.rows(tableId).find((r) => r.id === id)!.fields;
const activeAdmins = () => fake.rows(TABLES.usuarios.id).filter((r) => r.fields[U.rol] === "Admin" && r.fields[U.estado] === "Activo");

// ── N-02 · Usuarios con concurrencia ──────────────────────────────────────────

describe("Usuarios · concurrencia (N-02)", () => {
  it("dos Admins se desactivan entre sí a la vez: nunca quedan cero Admins activos", async () => {
    const bobId = seedUser({ nombre: "Bob Admin", email: "bob@kairos.test", rol: "Admin", sigla: "BB" });
    fake.barrier("update", TABLES.usuarios.id, 2); // los dos pasan el chequeo previo antes de escribir
    const [anaBajaABob, bobBajaAAna] = await Promise.all([
      setUsuarioActivo({ id: adminId }, bobId, false),
      setUsuarioActivo({ id: bobId }, adminId, false),
    ]);
    expect(activeAdmins().length).toBeGreaterThanOrEqual(1);
    // Cada resultado es coherente con la base: ok ⇒ el otro quedó inactivo; 409 ⇒ se revirtió.
    for (const [res, target] of [
      [anaBajaABob, bobId],
      [bobBajaAAna, adminId],
    ] as const) {
      if (res.ok) expect(fieldsOf(TABLES.usuarios.id, target)[U.estado]).toBe("Inactivo");
      else {
        expect(res).toMatchObject({ status: 409, error: "Tiene que quedar al menos un Admin activo." });
        expect(fieldsOf(TABLES.usuarios.id, target)[U.estado]).toBe("Activo");
      }
    }
    expect([anaBajaABob, bobBajaAAna].filter((r) => r.ok).length).toBeLessThanOrEqual(1);
  });

  it("desactivar y pasar a Empleado a la vez a los dos últimos Admins: nunca cero", async () => {
    const bobId = seedUser({ nombre: "Bob Admin", email: "bob@kairos.test", rol: "Admin", sigla: "BB" });
    fake.barrier("update", TABLES.usuarios.id, 2);
    await Promise.all([
      updateUsuario({ id: adminId }, bobId, { nombre: "Bob Admin", email: "bob@kairos.test", sigla: "BB", rol: "Empleado" }),
      setUsuarioActivo({ id: bobId }, adminId, false),
    ]);
    expect(activeAdmins().length).toBeGreaterThanOrEqual(1);
  });

  it("dos altas simultáneas con el mismo email: sobrevive exactamente una", async () => {
    fake.barrier("create", TABLES.usuarios.id, 2);
    const base = { nombre: "Nico", rol: "Empleado", password: "Temporal-Segura-1" };
    const results = await Promise.all([
      createUsuario({ ...base, email: "nico@kairos.test", sigla: "NA" }),
      createUsuario({ ...base, email: " NICO@kairos.test ", sigla: "NB" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ status: 409, fieldErrors: { email: "Ya existe un usuario con ese email." } });
    expect(fake.rows(TABLES.usuarios.id).filter((r) => r.fields[U.email] === "nico@kairos.test")).toHaveLength(1);
  }, 30_000);
});

// ── N-05 · Errores de Airtable ────────────────────────────────────────────────

describe("apiRoute · errores de Airtable (N-05)", () => {
  beforeEach(() => loginAs(adminId));

  const cases: [string, AirtableErrorCode, number, number, string][] = [
    ["not found", "not_found", 404, 404, API_MESSAGES.noEncontrado],
    ["rate limit después de los reintentos", "rate_limited", 429, 503, API_MESSAGES.noDisponible],
    ["5xx después de los reintentos", "server_error", 502, 503, API_MESSAGES.noDisponible],
    ["error de red", "network_error", 0, 503, API_MESSAGES.noDisponible],
    ["422", "invalid_request", 422, 500, API_MESSAGES.error],
    ["403 de Airtable", "forbidden", 403, 500, API_MESSAGES.error],
    ["inesperado", "unexpected", 418, 500, API_MESSAGES.error],
  ];

  it.each(cases)("%s → %s", async (_label, code, status, expected, message) => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.fail("list", UN.id, new AirtableError({ code, status, airtableType: "TIPO", message: `Airtable respondió ${status}: VALOR-PRIVADO del body` }));
    const res = await call("maestros/[tabla]/route.ts", "POST", { nombre: "X" }, { tabla: "unidades-de-negocio" });
    expect(res.status).toBe(expected);
    expect(res.json).toEqual({ error: message });
    const logs = JSON.stringify(errorLog.mock.calls);
    expect(logs).toContain(code);
    expect(logs).not.toContain("VALOR-PRIVADO");
    expect(res.text).not.toContain("VALOR-PRIVADO");
  });

  it("textos", () => {
    expect(API_MESSAGES).toEqual({
      noEncontrado: "No encontramos el registro.",
      noDisponible: "Airtable no está disponible. Probá de nuevo en unos minutos.",
      error: "Ocurrió un error. Probá de nuevo.",
    });
  });

  it("los caminos 400/405/409/415 siguen igual", async () => {
    fake.seed(UN.id, { [UN.fields.nombre]: "Existe" });
    const coll = "maestros/[tabla]/route.ts";
    expect((await call(coll, "POST", { nombre: "" }, { tabla: "unidades-de-negocio" })).status).toBe(400);
    expect((await call(coll, "POST", "{no json", { tabla: "unidades-de-negocio" })).status).toBe(400);
    expect((await call(coll, "POST", { nombre: "existe" }, { tabla: "unidades-de-negocio" })).status).toBe(409);
    const c = fake.seed(C.id, { [C.fields.nombre]: "A", [C.fields.estado]: "Lead" });
    expect((await call("maestros/[tabla]/[id]/route.ts", "DELETE", undefined, { tabla: "clientes", id: c })).status).toBe(405);

    const req = new NextRequest("http://localhost/api/admin/x", {
      method: "POST",
      body: "nombre=x",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${cookieJar.get(SESSION_COOKIE)}` },
    });
    expect((await route(coll).POST(req, { params: Promise.resolve({ tabla: "unidades-de-negocio" }) })).status).toBe(415);
  });
});

// ── N-06 · Tests negativos ────────────────────────────────────────────────────

const DISALLOWED_SLUGS = [
  "usuarios",
  "horas",
  "ventas",
  "compras",
  "tesoreria",
  "intentos-login",
  "intentos_login",
  "intentosLogin",
  "desconocida",
  "",
  "Clientes",
  "CLIENTES",
  "Unidades-De-Negocio",
  " clientes",
  "clientes ",
  "clientes%20",
  "%63lientes",
  "clientes%2F",
  "clientes/",
  "clientes/../usuarios",
  "..%2Fusuarios",
  "clientes\u0000",
  "unidades_de_negocio",
  "unidades de negocio",
  "constructor",
  "__proto__",
  "toString",
];
const SOME_ID = "recABCDEFGHIJKLMN";

describe("Maestros · slugs no permitidos → 404 (N-06)", () => {
  beforeEach(() => loginAs(adminId));

  const matrix = DISALLOWED_SLUGS.flatMap((tabla) => [
    { tabla, file: "maestros/[tabla]/route.ts", method: "POST" },
    { tabla, file: "maestros/[tabla]/[id]/route.ts", method: "PATCH" },
    { tabla, file: "maestros/[tabla]/[id]/route.ts", method: "DELETE" },
  ]);

  it("cubre todos los métodos exportados de las dos rutas dinámicas", () => {
    expect(Object.keys(route("maestros/[tabla]/route.ts")).filter((k) => k !== "default").sort()).toEqual(["POST"]);
    expect(Object.keys(route("maestros/[tabla]/[id]/route.ts")).filter((k) => k !== "default").sort()).toEqual(["DELETE", "PATCH"]);
  });

  it.each(matrix)("$method $file tabla=$tabla → 404", async ({ tabla, file, method }) => {
    const res = await call(file, method, method === "DELETE" ? undefined : { nombre: "X" }, { tabla, id: SOME_ID });
    expect(res.status).toBe(404);
    expect(writes()).toHaveLength(0);
  });
});

/** Payload válido mínimo por Maestro (los links se crean en setup). */
function validPayload(slug: (typeof MAESTRO_SLUGS)[number], n: number): Record<string, unknown> {
  switch (slug) {
    case "clientes":
      return { nombre: `MA Cliente ${n}`, estado: "Lead" };
    case "proveedores":
      return { nombre: `MA Prov ${n}`, cuit: n === 1 ? VALID_CUIT : "33-69345023-9" };
    case "proyectos": {
      const cliente = fake.rows(C.id).find((r) => r.fields[C.fields.sigla] === "MA")?.id ?? fake.seed(C.id, { [C.fields.nombre]: "MA", [C.fields.sigla]: "MA", [C.fields.estado]: "Cliente" });
      return { nombreCorto: `Proy ${n}`, cliente: [cliente], estado: "Activo" };
    }
    case "socios":
      return { sigla: n === 1 ? "MA" : "MB", nombre: "MA" };
    case "cuentas":
      return { nombre: `MA Cuenta ${n}`, moneda: "ARS" };
    case "categorias":
      return { nombre: `MA Cat ${n}`, tipo: "Gasto" };
    case "unidades-de-negocio":
      return { nombre: `MA UN ${n}` };
    case "tipos-de-operacion":
      return { nombre: `MA Op ${n}`, movimiento: "Pago" };
    case "tipos-de-comprobante":
      return { codigo: String(90 + n), descripcion: "MA", signo: "1" };
    case "parametros":
      return { concepto: `MA Param ${n}`, valor: "x" };
  }
}

const ALL_FIELD_IDS = Object.values(TABLES).flatMap((t) => Object.values(t.fields as Record<string, string>));
/** Claves que nunca tienen que llegar a Airtable. Todos los valores llevan "HACK". */
function junk(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    passwordHash: "HACK-hash",
    debeCambiarPassword: false,
    ultimoAcceso: "HACK-2020-01-01",
    codigo: "HACK - Código",
    Código: "HACK - Código acentuado",
    estadoInterno: "HACK-estado",
    unknownKey: "HACK-desconocida",
    constructor: "HACK-constructor",
    ...Object.fromEntries(ALL_FIELD_IDS.map((id) => [id, "HACK-field-id"])),
    ...extra,
  };
}
/** JSON.stringify ignora la clave __proto__ de un literal: se arma el body a mano. */
const withProto = (body: Record<string, unknown>) => JSON.stringify(body).replace(/^\{/, '{"__proto__":{"polluted":"HACK-proto"},');

describe("Mass assignment: claves que no son del spec nunca llegan a Airtable (N-06)", () => {
  beforeEach(() => loginAs(adminId));

  const expectClean = () => {
    const payloads = JSON.stringify(writes().map((c) => c.payload));
    expect(payloads).not.toContain("HACK");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  };

  it.each(MAESTRO_SLUGS.map((slug) => ({ slug })))("Maestro $slug: alta y edición", async ({ slug }) => {
    // En Tipos de comprobante "codigo" es un campo real: no se manda como basura.
    const omit = slug === "tipos-de-comprobante" ? ["codigo"] : [];
    const dirty = (n: number) => {
      const j = junk();
      for (const k of omit) delete j[k];
      return withProto({ ...j, ...validPayload(slug, n) });
    };
    const created = await call("maestros/[tabla]/route.ts", "POST", dirty(1), { tabla: slug });
    expect(created.status).toBe(201);
    const edited = await call("maestros/[tabla]/[id]/route.ts", "PATCH", dirty(2), { tabla: slug, id: created.json.id });
    expect(edited.status).toBe(200);
    expectClean();
    if (slug === "proyectos") expect(fieldsOf(P.id, created.json.id)[P.fields.codigo]).toBe("MA - Proy 2");
  });

  it("Usuarios: alta, edición, estado y reset", async () => {
    const valid = { nombre: "Nico", email: "nico@kairos.test", rol: "Empleado", sigla: "NN", password: "Temporal-Segura-1" };
    const created = await call("usuarios/route.ts", "POST", withProto({ ...junk(), ...valid }));
    expect(created.status).toBe(201);
    const id = created.json.id as string;
    const createPayload = (writes()[0].payload as Record<string, unknown>[])[0];
    expect(createPayload[U.debeCambiarPassword]).toBe(true);
    expect(createPayload).not.toHaveProperty(U.ultimoAcceso);
    expect(String(createPayload[U.passwordHash])).toMatch(/^\$2[aby]\$12\$/);

    expect((await call("usuarios/[id]/route.ts", "PATCH", withProto({ ...junk(), ...valid, nombre: "Nico 2" }), { id })).status).toBe(200);
    expect((await call("usuarios/[id]/estado/route.ts", "POST", withProto({ ...junk(), activo: false }), { id })).status).toBe(200);
    expect((await call("usuarios/[id]/password/route.ts", "POST", withProto({ ...junk(), password: "Otra-Temporal-22" }), { id })).status).toBe(200);
    expectClean();
    // Las ediciones nunca tocan hash, "Debe cambiar" ni "Último acceso" (salvo el reset, que pone hash nuevo + Debe cambiar = sí).
    const [, edit, estado, reset] = writes().map((c) => (c.payload as { fields: Record<string, unknown> }[])[0]);
    for (const w of [edit, estado]) {
      expect(w.fields).not.toHaveProperty(U.passwordHash);
      expect(w.fields).not.toHaveProperty(U.debeCambiarPassword);
      expect(w.fields).not.toHaveProperty(U.ultimoAcceso);
    }
    expect(Object.keys(estado.fields)).toEqual([U.estado]);
    expect(Object.keys(reset.fields).sort()).toEqual([U.passwordHash, U.debeCambiarPassword].sort());
    expect(reset.fields[U.debeCambiarPassword]).toBe(true);
  }, 30_000);
});

describe("Links inválidos → 400 (N-06)", () => {
  beforeEach(() => loginAs(adminId));

  function setup() {
    const cliente = fake.seed(C.id, { [C.fields.nombre]: "QA", [C.fields.sigla]: "QZ", [C.fields.estado]: "Cliente" });
    const lead = fake.seed(C.id, { [C.fields.nombre]: "Lead", [C.fields.sigla]: "LD", [C.fields.estado]: "Lead" });
    const un = fake.seed(UN.id, { [UN.fields.nombre]: "UN" });
    const gasto = fake.seed(CAT.id, { [CAT.fields.nombre]: "Gasto", [CAT.fields.tipo]: "Gasto" });
    const ingreso = fake.seed(CAT.id, { [CAT.fields.nombre]: "Ingreso", [CAT.fields.tipo]: "Ingreso" });
    const activo = fake.seed(P.id, { [P.fields.codigo]: "QZ - A", [P.fields.nombreCorto]: "A", [P.fields.estado]: "Activo" });
    const cerrado = fake.seed(P.id, { [P.fields.codigo]: "QZ - C", [P.fields.nombreCorto]: "C", [P.fields.estado]: "Cerrado" });
    const socio = fake.seed(TABLES.socios.id, { [TABLES.socios.fields.sigla]: "LR" });
    return { cliente, lead, un, gasto, ingreso, activo, cerrado, socio };
  }
  type Ids = ReturnType<typeof setup>;
  const NONEXISTENT = "recNOEXISTE000001";
  const MALFORMED = "no-es-un-id";

  const cases: { name: string; file: string; params?: Record<string, string>; key: string; body: (ids: Ids, bad: string[]) => Record<string, unknown>; bad: (ids: Ids) => [string, string][] }[] = [
    {
      name: "Proyectos · cliente",
      file: "maestros/[tabla]/route.ts",
      params: { tabla: "proyectos" },
      key: "cliente",
      body: (ids, bad) => ({ nombreCorto: "X", cliente: bad, unidadNegocio: [ids.un], estado: "Activo" }),
      bad: (ids) => [["inexistente", NONEXISTENT], ["mal formado", MALFORMED], ["de otra tabla (UN)", ids.un], ["no permitido (Lead)", ids.lead]],
    },
    {
      name: "Proyectos · unidad de negocio",
      file: "maestros/[tabla]/route.ts",
      params: { tabla: "proyectos" },
      key: "unidadNegocio",
      body: (ids, bad) => ({ nombreCorto: "X", cliente: [ids.cliente], unidadNegocio: bad, estado: "Activo" }),
      bad: (ids) => [["inexistente", NONEXISTENT], ["de otra tabla (cliente)", ids.cliente]],
    },
    {
      name: "Proveedores · categoría",
      file: "maestros/[tabla]/route.ts",
      params: { tabla: "proveedores" },
      key: "categoriaPorDefecto",
      body: (_ids, bad) => ({ nombre: "P", cuit: VALID_CUIT, categoriaPorDefecto: bad }),
      bad: (ids) => [["inexistente", NONEXISTENT], ["de otra tabla (UN)", ids.un], ["no permitida (Ingreso)", ids.ingreso]],
    },
    {
      name: "Tipos de operación · categoría",
      file: "maestros/[tabla]/route.ts",
      params: { tabla: "tipos-de-operacion" },
      key: "categoriaPorDefecto",
      body: (_ids, bad) => ({ nombre: "Op", movimiento: "Pago", categoriaPorDefecto: bad }),
      bad: (ids) => [["inexistente", NONEXISTENT], ["de otra tabla (proyecto)", ids.activo]],
    },
    {
      name: "Usuarios · socio",
      file: "usuarios/route.ts",
      key: "socio",
      body: (_ids, bad) => ({ nombre: "N", email: "n@kairos.test", rol: "Empleado", sigla: "NN", password: "Temporal-Segura-1", socio: bad }),
      bad: (ids) => [["inexistente", NONEXISTENT], ["de otra tabla (cliente)", ids.cliente]],
    },
    {
      name: "Usuarios · proyectos asignados",
      file: "usuarios/route.ts",
      key: "proyectosAsignados",
      body: (_ids, bad) => ({ nombre: "N", email: "n@kairos.test", rol: "Empleado", sigla: "NN", password: "Temporal-Segura-1", proyectosAsignados: bad }),
      bad: (ids) => [["inexistente", NONEXISTENT], ["de otra tabla (UN)", ids.un], ["no permitido (Cerrado)", ids.cerrado], ["mezclado con uno válido", ids.cerrado]],
    },
  ];

  it.each(cases)("$name: inexistente, de otra tabla y no permitido → 400", async ({ file, params, key, body, bad }) => {
    const ids = setup();
    for (const [label, badId] of bad(ids)) {
      const value = label.startsWith("mezclado") ? [ids.activo, badId] : [badId];
      const res = await call(file, "POST", body(ids, value), params);
      expect(res.status, label).toBe(400);
      expect(res.json.fieldErrors[key], label).toBe("Elegí una opción válida.");
    }
    expect(writes()).toHaveLength(0);
  });
});

// ── N-06 · Páginas Admin con sesión de Empleado ───────────────────────────────

const PAGES = import.meta.glob<{ default: () => unknown }>("/app/\\(admin\\)/**/page.tsx", { eager: true });

/**
 * "Render" de servidor mínimo: evalúa el árbol de elementos llamando a cada
 * componente (await en los async). Alcanza para ver si el guard corta antes de
 * que corra cualquier componente de datos.
 */
async function renderServerTree(node: unknown): Promise<void> {
  if (Array.isArray(node)) {
    for (const child of node) await renderServerTree(child);
    return;
  }
  if (!isValidElement(node)) return;
  const { type, props } = node as { type: unknown; props: { children?: unknown } };
  if (typeof type === "function") return renderServerTree(await (type as (p: unknown) => unknown)(props));
  return renderServerTree(props.children);
}

async function redirectOf(render: () => Promise<void>): Promise<string | null> {
  try {
    await render();
    return null;
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw err;
    return digest.split(";")[2];
  }
}

describe("Páginas Admin con sesión de Empleado (N-06)", () => {
  const pages = Object.entries(PAGES).map(([file, mod]) => ({ file: file.replace(/^\//, ""), Page: mod.default }));

  it("se encontraron todas las páginas Admin", () => {
    expect(pages.length).toBeGreaterThanOrEqual(14);
    expect(pages.map((p) => p.file)).toEqual(expect.arrayContaining(["app/(admin)/usuarios/page.tsx", "app/(admin)/maestros/clientes/page.tsx"]));
  });

  it.each(pages)("$file → redirige a /mis-horas sin llamar a Airtable", async ({ Page }) => {
    await loginAs(empleadoId);
    // El guard lee el usuario de la sesión (caché de 30 s): se calienta antes y se mide solo la página.
    await redirectOf(() => renderServerTree(Page()));
    fake.calls.length = 0;
    expect(await redirectOf(() => renderServerTree(Page()))).toBe("/mis-horas");
    expect(fake.calls).toEqual([]);
  });
});
