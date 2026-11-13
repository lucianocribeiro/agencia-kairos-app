import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { createFakeAirtable } from "./fake-airtable";

/**
 * Rutas de /api/admin/** con guard, credenciales y servicios reales sobre un
 * Airtable falso. Solo se simulan cookies, connection() y el entorno.
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

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ROUTE_MODULES = import.meta.glob<Record<string, Handler>>("/app/api/admin/**/route.ts", { eager: true });
const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const U = TABLES.usuarios.fields;
const PR = TABLES.proyectos;
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
  vi.spyOn(console, "error").mockImplementation(() => {});
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

function request(method: string, path: string, body?: unknown) {
  const cookie = cookieJar.get(SESSION_COOKIE);
  return new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
  });
}

const routeFile = (key: string) => key.replace(/^\//, "");
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const handler = (file: string, method: (typeof HTTP)[number]) => ROUTE_MODULES[`/${file}`][method];

// Todas las combinaciones ruta × método exportado
const endpoints = Object.entries(ROUTE_MODULES).flatMap(([key, mod]) =>
  HTTP.filter((m) => typeof mod[m] === "function").map((m) => ({ file: routeFile(key), method: m })),
);
const paramsFor = (file: string) => ({
  ...(file.includes("[tabla]") ? { tabla: "unidades-de-negocio" } : {}),
  ...(file.includes("[id]") ? { id: "recXXXXXXXXXXXXXX" } : {}),
});

describe("todas las rutas /api/admin/** (parametrizado)", () => {
  it("hay rutas para probar", () => expect(endpoints.length).toBeGreaterThanOrEqual(7));

  it.each(endpoints)("$method $file sin sesión → 401", async ({ file, method }) => {
    const res = await handler(file, method)(request(method, "/api/admin/x", method === "DELETE" || method === "GET" ? undefined : {}), ctx(paramsFor(file)));
    expect(res.status).toBe(401);
  });

  it.each(endpoints)("$method $file con sesión de Empleado → 403", async ({ file, method }) => {
    await loginAs(empleadoId);
    const res = await handler(file, method)(request(method, "/api/admin/x", method === "DELETE" || method === "GET" ? undefined : {}), ctx(paramsFor(file)));
    expect(res.status).toBe(403);
    // y no tocó nada
    expect(fake.calls.some((c) => c.method !== "list")).toBe(false);
  });
});

const USUARIOS = "app/api/admin/usuarios/route.ts";
const USUARIO = "app/api/admin/usuarios/[id]/route.ts";
const ESTADO = "app/api/admin/usuarios/[id]/estado/route.ts";
const PASSWORD = "app/api/admin/usuarios/[id]/password/route.ts";

const nuevo = (over: Record<string, unknown> = {}) => ({
  nombre: "Nico Nuevo",
  email: "  Nico@Kairos.TEST ",
  rol: "Empleado",
  sigla: "nn",
  password: "Temporal-Segura-1",
  ...over,
});

async function call(file: string, method: (typeof HTTP)[number], body?: unknown, params: Record<string, string> = {}) {
  const res = await handler(file, method)(request(method, "/api/admin/x", body), ctx(params));
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

describe("Usuarios · respuestas sin passwordHash", () => {
  beforeEach(() => loginAs(adminId));

  it("crear, editar, activar/desactivar y resetear nunca devuelven el hash ni la contraseña", async () => {
    const created = await call(USUARIOS, "POST", nuevo());
    expect(created.status).toBe(201);
    const id = created.json.id as string;
    const responses = [
      created,
      await call(USUARIO, "PATCH", { ...nuevo(), nombre: "Nico Editado" }, { id }),
      await call(ESTADO, "POST", { activo: false }, { id }),
      await call(ESTADO, "POST", { activo: true }, { id }),
      await call(PASSWORD, "POST", { password: "Otra-Temporal-22" }, { id }),
      await call(USUARIOS, "POST", nuevo()), // duplicado → 409
      await call(PASSWORD, "POST", { password: "corta" }, { id }), // 400
    ];
    const storedHash = String(fake.rows(TABLES.usuarios.id).find((r) => r.id === id)!.fields[U.passwordHash]);
    expect(storedHash).toMatch(/^\$2[aby]\$12\$/);
    for (const r of responses) {
      expect(r.text).not.toContain(storedHash);
      expect(r.text).not.toContain(U.passwordHash);
      expect(r.text).not.toMatch(/\$2[aby]\$/);
      expect(r.text).not.toContain("Temporal-Segura-1");
      expect(r.text).not.toContain("Otra-Temporal-22");
      expect(r.text.toLowerCase()).not.toContain("passwordhash");
    }
  }, 30_000);

  it("la lista de usuarios no pide el hash a Airtable", async () => {
    const { loadUsuarios } = await import("@/lib/abm/server/usuarios-service");
    const data = await loadUsuarios();
    expect(JSON.stringify(data)).not.toContain(hash);
    const usuariosLists = fake.calls.filter((c) => c.method === "list" && c.tableId === TABLES.usuarios.id);
    for (const c of usuariosLists) expect((c.options as { fields: string[] }).fields).not.toContain(U.passwordHash);
  });
});

describe("Usuarios · alta", () => {
  beforeEach(() => loginAs(adminId));

  it("guarda email en minúsculas, sigla en mayúsculas, Activo y Debe cambiar password = sí", async () => {
    const res = await call(USUARIOS, "POST", nuevo());
    expect(res.status).toBe(201);
    const f = fake.rows(TABLES.usuarios.id).find((r) => r.id === res.json.id)!.fields;
    expect(f).toMatchObject({ [U.email]: "nico@kairos.test", [U.sigla]: "NN", [U.estado]: "Activo", [U.debeCambiarPassword]: true });
    expect(await bcrypt.compare("Temporal-Segura-1", String(f[U.passwordHash]))).toBe(true);
  }, 30_000);

  it("email y sigla únicos sin distinguir mayúsculas", async () => {
    expect((await call(USUARIOS, "POST", nuevo({ email: "ANA@kairos.test" }))).json).toMatchObject({
      fieldErrors: { email: "Ya existe un usuario con ese email." },
    });
    expect((await call(USUARIOS, "POST", nuevo({ sigla: "aa" }))).json).toMatchObject({
      fieldErrors: { sigla: "Ya existe un usuario con esa sigla." },
    });
  });

  it("validaciones: sigla 2–4 letras, email válido, contraseña de la política", async () => {
    const res = await call(USUARIOS, "POST", nuevo({ sigla: "A1", email: "no-es-mail", password: "ñ".repeat(37) }));
    expect(res.status).toBe(400);
    expect(res.json.fieldErrors).toEqual({
      sigla: "La sigla tiene que tener entre 2 y 4 letras.",
      email: "Ingresá un email válido.",
      password: "La contraseña no puede superar los 72 bytes (los caracteres con tilde o emojis ocupan más de uno).",
    });
    expect((await call(USUARIOS, "POST", nuevo({ password: "" }))).json.fieldErrors.password).toBe("Ingresá o generá una contraseña temporal.");
  });

  it("proyectos asignados: solo Activos; para un Admin no se guardan", async () => {
    const activo = fake.seed(PR.id, { [PR.fields.codigo]: "QZ - A", [PR.fields.estado]: "Activo" });
    const cerrado = fake.seed(PR.id, { [PR.fields.codigo]: "QZ - C", [PR.fields.estado]: "Cerrado" });
    const sinEstado = fake.seed(PR.id, { [PR.fields.codigo]: "QZ - S" });
    for (const p of [cerrado, sinEstado]) {
      expect((await call(USUARIOS, "POST", nuevo({ proyectosAsignados: [p] }))).json).toMatchObject({
        fieldErrors: { proyectosAsignados: "Elegí una opción válida." },
      });
    }
    const ok = await call(USUARIOS, "POST", nuevo({ proyectosAsignados: [activo] }));
    expect(fake.rows(TABLES.usuarios.id).find((r) => r.id === ok.json.id)!.fields[U.proyectosAsignados]).toEqual([activo]);

    const admin = await call(USUARIOS, "POST", nuevo({ email: "otro@kairos.test", sigla: "OT", rol: "Admin", proyectosAsignados: [activo] }));
    expect(fake.rows(TABLES.usuarios.id).find((r) => r.id === admin.json.id)!.fields[U.proyectosAsignados]).toBeUndefined();
  }, 30_000);
});

describe("Usuarios · edición y reglas de seguridad", () => {
  beforeEach(() => loginAs(adminId));
  const edit = (id: string, over: Record<string, unknown>) =>
    call(USUARIO, "PATCH", { nombre: "X", email: `${id.toLowerCase()}@kairos.test`, sigla: "XX", ...over }, { id });

  it("edición se excluye a sí misma en la unicidad", async () => {
    expect((await edit(empleadoId, { email: "EVA@kairos.test", sigla: "ee", rol: "Empleado" })).status).toBe(200);
    expect((await edit(empleadoId, { email: "ana@kairos.test", sigla: "EE", rol: "Empleado" })).status).toBe(409);
  });

  it("un Admin no puede cambiarse el rol ni desactivarse a sí mismo", async () => {
    seedUser({ nombre: "Otro Admin", email: "otro@kairos.test", rol: "Admin", sigla: "OA" });
    expect((await edit(adminId, { email: "ana@kairos.test", sigla: "AA", rol: "Empleado" })).json).toMatchObject({
      error: "No podés cambiar tu propio rol.",
    });
    expect((await call(ESTADO, "POST", { activo: false }, { id: adminId })).json).toEqual({ error: "No podés desactivar tu propio usuario." });
    expect((await call(PASSWORD, "POST", { password: "Temporal-Segura-1" }, { id: adminId })).status).toBe(409);
  });

  it("el último Admin activo no se puede desactivar ni pasar a Empleado (409)", async () => {
    const otro = seedUser({ nombre: "Otro Admin", email: "otro@kairos.test", rol: "Admin", sigla: "OA", estado: "Inactivo" });
    // Ana es la única Admin activa: el otro está inactivo. Probamos sobre "otro" activándolo y actuando desde él.
    await loginAs(otro); // inactivo → sesión inválida
    expect((await call(ESTADO, "POST", { activo: false }, { id: adminId })).status).toBe(401);

    // Un segundo Admin activo intenta desactivar a Ana mientras es la única otra activa → permitido
    fake.rows(TABLES.usuarios.id).find((r) => r.id === otro)!.fields[U.estado] = "Activo";
    clearUserCache();
    expect((await call(ESTADO, "POST", { activo: false }, { id: adminId })).status).toBe(200);
    // Ahora "otro" es el último Admin activo: Ana (inactiva) no cuenta. Nadie más puede bajarlo:
    // se prueba con el servicio directo porque un Admin no puede desactivarse a sí mismo.
    const { setUsuarioActivo, updateUsuario } = await import("@/lib/abm/server/usuarios-service");
    expect(await setUsuarioActivo({ id: "recALGUIEN0000000" }, otro, false)).toMatchObject({
      status: 409,
      error: "Tiene que quedar al menos un Admin activo.",
    });
    expect(await updateUsuario({ id: "recALGUIEN0000000" }, otro, { nombre: "O", email: "otro@kairos.test", sigla: "OA", rol: "Empleado" })).toMatchObject({
      status: 409,
      error: "Tiene que quedar al menos un Admin activo.",
    });
  });

  it("Empleado → Admin conserva las asignaciones (no las toca)", async () => {
    const p = fake.seed(PR.id, { [PR.fields.codigo]: "QZ - A", [PR.fields.estado]: "Activo" });
    fake.rows(TABLES.usuarios.id).find((r) => r.id === empleadoId)!.fields[U.proyectosAsignados] = [p];
    expect((await edit(empleadoId, { email: "eva@kairos.test", sigla: "EE", rol: "Admin", proyectosAsignados: [] })).status).toBe(200);
    const f = fake.rows(TABLES.usuarios.id).find((r) => r.id === empleadoId)!.fields;
    expect(f[U.rol]).toBe("Admin");
    expect(f[U.proyectosAsignados]).toEqual([p]);
  });

  it("reset de contraseña: hash nuevo, Debe cambiar = sí, y la sesión vieja del usuario muere", async () => {
    const before = String(fake.rows(TABLES.usuarios.id).find((r) => r.id === empleadoId)!.fields[U.passwordHash]);
    expect((await call(PASSWORD, "POST", { password: "Nueva-Temporal-9" }, { id: empleadoId })).status).toBe(200);
    const f = fake.rows(TABLES.usuarios.id).find((r) => r.id === empleadoId)!.fields;
    expect(f[U.passwordHash]).not.toBe(before);
    expect(f[U.debeCambiarPassword]).toBe(true);

    // La cookie del empleado tenía el pf del hash viejo → ahora es inválida (401, no 403).
    await loginAs(empleadoId);
    expect((await call(ESTADO, "POST", { activo: true }, { id: empleadoId })).status).toBe(401);
  }, 30_000);
});

describe("Maestros por la ruta (smoke de cableado)", () => {
  const COLL = "app/api/admin/maestros/[tabla]/route.ts";
  const ITEM = "app/api/admin/maestros/[tabla]/[id]/route.ts";
  beforeEach(() => loginAs(adminId));

  it("crear, editar y borrar una unidad de negocio; 404 para una tabla inexistente", async () => {
    const created = await call(COLL, "POST", { nombre: "QA UN" }, { tabla: "unidades-de-negocio" });
    expect(created.status).toBe(201);
    const id = created.json.id;
    expect((await call(ITEM, "PATCH", { nombre: "QA UN 2" }, { tabla: "unidades-de-negocio", id })).status).toBe(200);
    expect((await call(ITEM, "DELETE", undefined, { tabla: "unidades-de-negocio", id })).status).toBe(200);
    expect((await call(COLL, "POST", { nombre: "x" }, { tabla: "horas" })).status).toBe(404);
  });
});

describe("Clientes · Estado Activo / Inactivo y borrado (F2-01)", () => {
  const COLL = "app/api/admin/maestros/[tabla]/route.ts";
  const ITEM = "app/api/admin/maestros/[tabla]/[id]/route.ts";
  const REFS = "app/api/admin/maestros/[tabla]/[id]/referencias/route.ts";
  const C = TABLES.clientes;
  beforeEach(() => loginAs(adminId));

  it("la ruta nueva de referencias existe y exporta solo GET", () => {
    expect(Object.keys(ROUTE_MODULES[`/${REFS}`]).filter((k) => HTTP.includes(k as (typeof HTTP)[number]))).toEqual(["GET"]);
  });

  it("Empleado → 403 en el chequeo previo y en el borrado de un cliente; no se borra nada", async () => {
    const c = fake.seed(C.id, { [C.fields.nombre]: "QA", [C.fields.sigla]: "QA", [C.fields.estado]: "Activo" });
    await loginAs(empleadoId);
    expect((await call(REFS, "GET", undefined, { tabla: "clientes", id: c })).status).toBe(403);
    expect((await call(ITEM, "DELETE", undefined, { tabla: "clientes", id: c })).status).toBe(403);
    expect((await call(COLL, "POST", { nombre: "QB", sigla: "QB", estado: "Activo" }, { tabla: "clientes" })).status).toBe(403);
    expect(fake.rows(C.id).map((r) => r.id)).toEqual([c]);
    expect(fake.calls.some((x) => x.method !== "list")).toBe(false);
  });

  it("alta: sin sigla → 400; sigla duplicada → 409; válida → 201", async () => {
    fake.seed(C.id, { [C.fields.nombre]: "Existente", [C.fields.sigla]: "EX", [C.fields.estado]: "Inactivo" });
    expect((await call(COLL, "POST", { nombre: "QA", estado: "Activo" }, { tabla: "clientes" })).json).toMatchObject({
      fieldErrors: { sigla: "Este campo es obligatorio." },
    });
    const dup = await call(COLL, "POST", { nombre: "QA", estado: "Activo", sigla: "ex" }, { tabla: "clientes" });
    expect(dup.status).toBe(409);
    const ok = await call(COLL, "POST", { nombre: "QA", estado: "Activo", sigla: "qa" }, { tabla: "clientes" });
    expect(ok.status).toBe(201);
  });

  it("referenciado: el chequeo y el DELETE dan el mensaje con conteos; sin referencias se borra", async () => {
    const c = fake.seed(C.id, { [C.fields.nombre]: "QA", [C.fields.sigla]: "QA", [C.fields.estado]: "Activo", [C.fields.proyectos]: ["recPPPPPPPPPPPPPP"] });
    const msg = "No se puede borrar: tiene 1 proyecto. Pasalo a Inactivo.";
    expect((await call(REFS, "GET", undefined, { tabla: "clientes", id: c })).json).toMatchObject({ ok: true, blocked: msg });
    const blocked = await call(ITEM, "DELETE", undefined, { tabla: "clientes", id: c });
    expect(blocked).toMatchObject({ status: 409, json: { error: msg } });
    delete fake.rows(C.id).find((r) => r.id === c)!.fields[C.fields.proyectos];
    expect((await call(REFS, "GET", undefined, { tabla: "clientes", id: c })).json).toMatchObject({ ok: true, blocked: null });
    expect((await call(ITEM, "DELETE", undefined, { tabla: "clientes", id: c })).status).toBe(200);
    expect(fake.rows(C.id)).toHaveLength(0);
  });

  it("el picker de Cliente en Proyectos ofrece solo Activos; elegir un Inactivo → 400", async () => {
    const { loadMaestro } = await import("@/lib/abm/server/maestros-service");
    const activo = fake.seed(C.id, { [C.fields.nombre]: "QA Activo", [C.fields.sigla]: "QA", [C.fields.estado]: "Activo" });
    const inactivo = fake.seed(C.id, { [C.fields.nombre]: "QA Inactivo", [C.fields.sigla]: "QI", [C.fields.estado]: "Inactivo" });
    const viejo = fake.seed(C.id, { [C.fields.nombre]: "QA Viejo", [C.fields.sigla]: "QV", [C.fields.estado]: "Cliente" });
    const ids = (await loadMaestro("proyectos")).options.cliente.map((o) => o.id);
    expect(ids).toEqual([activo]);
    expect(ids).not.toContain(inactivo);
    expect(ids).not.toContain(viejo);
    const res = await call(COLL, "POST", { nombreCorto: "X", cliente: [inactivo], estado: "Activo" }, { tabla: "proyectos" });
    expect(res.status).toBe(400);
    expect(res.json.fieldErrors.cliente).toBeTruthy();
  });

  it("Horas: el filtro de clientes marca solo los Activos (los Inactivos quedan para el nombre)", async () => {
    const { loadHorasOptions } = await import("@/lib/horas/server/admin-service");
    const activo = fake.seed(C.id, { [C.fields.nombre]: "QA Activo", [C.fields.sigla]: "QA", [C.fields.estado]: "Activo" });
    const inactivo = fake.seed(C.id, { [C.fields.nombre]: "QA Inactivo", [C.fields.sigla]: "QI", [C.fields.estado]: "Inactivo" });
    const { clientes } = await loadHorasOptions();
    expect(clientes.filter((c) => c.activo).map((c) => c.id)).toEqual([activo]);
    expect(clientes.find((c) => c.id === inactivo)).toMatchObject({ activo: false, nombre: "QA Inactivo" });
  });
});
