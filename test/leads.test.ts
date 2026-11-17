import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { createFakeAirtable } from "./fake-airtable";

/**
 * Leads (CC-F4-06): rutas /api/admin/leads/** con guard, servicio y ABM de Clientes reales sobre
 * un Airtable falso. Datos sintéticos (QA).
 */
const SECRET = "a".repeat(44);
const fake = createFakeAirtable();
const cookieJar = new Map<string, string>();

class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
  unstable_rethrow: (err: unknown) => {
    if (err instanceof RedirectSignal) throw err;
  },
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/leads",
}));
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
const { LEAD_MESSAGES } = await import("@/lib/leads/leads");
const { CONVERSION_MAP } = await import("@/lib/leads/server/service");
const { LeadsPage } = await import("@/components/leads/server/leads-page");
const { NAV_BY_ROLE } = await import("@/components/shell/nav-config");
const { MAESTRO_MESSAGES } = await import("@/lib/abm/maestros");

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const LEAD_ROUTES = import.meta.glob<Record<string, Handler>>("/app/api/admin/leads/**/route.ts", { eager: true });
const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const U = TABLES.usuarios.fields;
const C = TABLES.clientes;
const L = TABLES.leads;
const LIST = "app/api/admin/leads/route.ts";
const ONE = "app/api/admin/leads/[id]/route.ts";
const CONV = "app/api/admin/leads/[id]/convertir/route.ts";

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("clave-de-prueba", 4);
});

let ids: Record<string, string>;
beforeEach(() => {
  fake.reset();
  cookieJar.clear();
  clearUserCache();
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const user = (nombre: string, rol: string) =>
    fake.seed(TABLES.usuarios.id, {
      [U.nombre]: nombre,
      [U.email]: `${nombre.toLowerCase().replace(/ /g, ".")}@kairos.test`,
      [U.rol]: rol,
      [U.estado]: "Activo",
      [U.debeCambiarPassword]: false,
      [U.passwordHash]: hash,
    });
  const cliExistente = fake.seed(C.id, { [C.fields.nombre]: "QA Existente SA", [C.fields.sigla]: "QX", [C.fields.estado]: "Activo" });
  const lead = fake.seed(L.id, {
    [L.fields.nombre]: "QA Lead Uno",
    [L.fields.tipo]: "Lead",
    [L.fields.status]: "Activo",
    [L.fields.proyecto]: "Web nueva",
    [L.fields.contacto]: "QA Contacto",
    [L.fields.telefono]: "+54 9 11 0000-0000",
    [L.fields.mail]: "qa.lead@kairos.test",
    [L.fields.origen]: "Referidos",
    [L.fields.referidoPor]: "QA Ref",
    [L.fields.comentarios]: "QA comentario",
    [L.fields.ventas]: "QA V",
  });
  const convertido = fake.seed(L.id, { [L.fields.nombre]: "QA Lead Convertido", [L.fields.tipo]: "Cliente", [L.fields.cliente]: [cliExistente] });
  ids = { admin: user("Ana Admin", "Admin"), eva: user("Eva Empleada", "Empleado"), cli: user("Carla Cliente", "Cliente"), cliExistente, lead, convertido };
});

async function loginAs(userId: string) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}

async function call(file: string, method: string, opts: { body?: unknown; id?: string } = {}) {
  const cookie = cookieJar.get(SESSION_COOKIE);
  const req = new NextRequest("http://localhost/api/x", {
    method,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
  });
  const res = await LEAD_ROUTES[`/${file}`][method](req, { params: Promise.resolve<Record<string, string>>(opts.id ? { id: opts.id } : {}) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
}

const writes = () => fake.calls.filter((c) => c.method !== "list");
const leadRow = (id: string) => fake.rows(L.id).find((r) => r.id === id);
const clientes = () => fake.rows(C.id);
const form = (over: Record<string, unknown> = {}) => ({
  nombre: "QA Lead Nuevo",
  tipo: "Lead",
  status: "Activo",
  proyecto: "",
  contacto: "",
  telefono: "",
  mail: "",
  origen: "Orgánico",
  referidoPor: "",
  comentarios: "",
  ventas: "",
  cobranzas: "",
  ventasSrl: "",
  cobranzasSrl: "",
  ...over,
});

// ── Acceso ──────────────────────────────────────────────────────────────────

describe("Leads · acceso (solo Admin)", () => {
  const endpoints = Object.entries(LEAD_ROUTES).flatMap(([key, mod]) => HTTP.filter((m) => typeof mod[m] === "function").map((m) => ({ file: key.slice(1), method: m })));

  it("las rutas son exactamente POST leads, PATCH/DELETE leads/[id] y POST leads/[id]/convertir", () => {
    expect(endpoints.map((e) => `${e.method} ${e.file}`).sort()).toEqual([`DELETE ${ONE}`, `PATCH ${ONE}`, `POST ${CONV}`, `POST ${LIST}`].sort());
  });

  it.each(endpoints)("$method $file: Empleado y Cliente → 403 sin escribir; sin sesión → 401", async ({ file, method }) => {
    for (const who of [ids.eva, ids.cli]) {
      await loginAs(who);
      const res = await call(file, method, { id: ids.lead, ...(method === "DELETE" ? {} : { body: { ...form(), sigla: "QZ" } }) });
      expect(res.status).toBe(403);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    cookieJar.clear();
    expect((await call(file, method, { id: ids.lead, ...(method === "DELETE" ? {} : { body: {} }) })).status).toBe(401);
    expect(writes()).toEqual([]);
  });

  it("página /leads: Empleado → /mis-horas, Cliente → /cliente/horas; Admin la ve", async () => {
    await loginAs(ids.eva);
    await expect(LeadsPage()).rejects.toThrow("REDIRECT /mis-horas");
    await loginAs(ids.cli);
    await expect(LeadsPage()).rejects.toThrow("REDIRECT /cliente/horas");
    await loginAs(ids.admin);
    const el = await LeadsPage();
    expect(el.props.leads.map((l: { values: { nombre: string } }) => l.values.nombre).sort()).toEqual(["QA Lead Convertido", "QA Lead Uno"]);
  });

  it("menú: «Leads» solo en Admin, después de Maestros", () => {
    const admin = NAV_BY_ROLE.Admin.map((i) => i.label);
    expect(admin.indexOf("Leads")).toBe(admin.indexOf("Maestros") + 1);
    for (const role of ["Empleado", "Cliente"] as const) expect(NAV_BY_ROLE[role].some((i) => i.href === "/leads")).toBe(false);
  });
});

// ── ABM ─────────────────────────────────────────────────────────────────────

describe("Leads · alta, edición y borrado", () => {
  beforeEach(() => loginAs(ids.admin));

  it("alta con los 14 campos (vacíos no se escriben); nunca escribe el link Cliente", async () => {
    const res = await call(LIST, "POST", { body: form({ mail: "  qa@kairos.test ", telefono: "+54 11 1234", cliente: [ids.cliExistente] }) });
    expect(res.status).toBe(201);
    expect(leadRow(res.json.id)!.fields).toEqual({
      [L.fields.nombre]: "QA Lead Nuevo",
      [L.fields.tipo]: "Lead",
      [L.fields.status]: "Activo",
      [L.fields.origen]: "Orgánico",
      [L.fields.mail]: "qa@kairos.test",
      [L.fields.telefono]: "+54 11 1234",
    });
  });

  it("Nombre obligatorio; mail inválido; opciones inválidas → 400 sin escribir", async () => {
    const res = await call(LIST, "POST", { body: form({ nombre: "  ", mail: "no-es-mail", origen: "Instagram", status: "Cerrado" }) });
    expect(res.status).toBe(400);
    expect(res.json.fieldErrors).toEqual({ nombre: "Este campo es obligatorio.", mail: "Ingresá un email válido.", origen: "Elegí una opción válida.", status: "Elegí una opción válida." });
    expect(writes()).toEqual([]);
  });

  it("Tipo «Cliente» a mano → 400 en alta y en edición, sin escribir", async () => {
    const alta = await call(LIST, "POST", { body: form({ tipo: "Cliente" }) });
    expect(alta.status).toBe(400);
    expect(alta.json.fieldErrors.tipo).toBe(LEAD_MESSAGES.tipoCliente);
    const edit = await call(ONE, "PATCH", { id: ids.lead, body: form({ tipo: " Cliente " }) });
    expect(edit.status).toBe(400);
    expect(edit.json.fieldErrors.tipo).toBe(LEAD_MESSAGES.tipoCliente);
    expect(writes()).toEqual([]);
  });

  it("edición: escribe los 14 campos (vacío = borrar) y nunca el link Cliente", async () => {
    const res = await call(ONE, "PATCH", { id: ids.lead, body: form({ nombre: "QA Lead Uno Editado", tipo: "Frío", cliente: [ids.cliExistente] }) });
    expect(res.status).toBe(200);
    const f = leadRow(ids.lead)!.fields;
    expect(f[L.fields.nombre]).toBe("QA Lead Uno Editado");
    expect(f[L.fields.tipo]).toBe("Frío");
    expect(f[L.fields.contacto]).toBeUndefined();
    expect(f[L.fields.cliente]).toBeUndefined();
    const update = writes().find((c) => c.method === "update")!;
    expect(Object.keys((update.payload as { fields: object }[])[0].fields)).not.toContain(L.fields.cliente);
  });

  it("editar un lead convertido → 409 sin escribir", async () => {
    const res = await call(ONE, "PATCH", { id: ids.convertido, body: form({ nombre: "QA Otro nombre" }) });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe(LEAD_MESSAGES.convertido);
    expect(writes()).toEqual([]);
  });

  it("un lead con Tipo Cliente sin link (su cliente se borró) también es de solo lectura", async () => {
    const huerfano = fake.seed(L.id, { [L.fields.nombre]: "QA Huerfano", [L.fields.tipo]: "Cliente" });
    expect((await call(ONE, "PATCH", { id: huerfano, body: form() })).status).toBe(409);
    expect((await call(CONV, "POST", { id: huerfano, body: { sigla: "QH" } })).status).toBe(409);
    expect(writes()).toEqual([]);
  });

  it("edición: si en el medio el lead pasó a cliente, se restaura con Tipo = Cliente → 409", async () => {
    const original = { ...leadRow(ids.lead)!.fields };
    fake.failWhen((c, i) => {
      if (c.method === "update" && c.tableId === L.id && i === 0) {
        // Otra persona convirtió el lead justo antes de nuestra escritura.
        Object.assign(leadRow(ids.lead)!.fields, { [L.fields.tipo]: "Cliente", [L.fields.cliente]: [ids.cliExistente] });
      }
      return false;
    });
    const res = await call(ONE, "PATCH", { id: ids.lead, body: form({ nombre: "QA Pisado" }) });
    expect(res.status).toBe(409);
    const f = leadRow(ids.lead)!.fields;
    expect(f[L.fields.nombre]).toBe(original[L.fields.nombre]);
    expect(f[L.fields.tipo]).toBe("Cliente");
    expect(f[L.fields.cliente]).toEqual([ids.cliExistente]);
  });

  it("borrado: físico, también de un convertido; el cliente vinculado no se toca", async () => {
    const antes = JSON.stringify(clientes());
    expect((await call(ONE, "DELETE", { id: ids.convertido })).status).toBe(200);
    expect(leadRow(ids.convertido)).toBeUndefined();
    expect(JSON.stringify(clientes())).toBe(antes);
    expect(writes().map((c) => `${c.method}:${c.tableId}`)).toEqual([`delete:${L.id}`]);
    expect((await call(ONE, "DELETE", { id: ids.lead })).status).toBe(200);
    expect((await call(ONE, "DELETE", { id: ids.lead })).status).toBe(404);
  });

  it("ID inválido → 404", async () => {
    expect((await call(ONE, "PATCH", { id: "x", body: form() })).status).toBe(404);
    expect((await call(ONE, "DELETE", { id: "recNOEXISTE0000000" })).status).toBe(404);
    expect((await call(CONV, "POST", { id: "recNOEXISTE000000", body: { sigla: "QZ" } })).status).toBe(404);
  });
});

// ── Conversión ──────────────────────────────────────────────────────────────

describe("Leads · Pasar a cliente", () => {
  beforeEach(() => loginAs(ids.admin));

  it("camino feliz: cliente Activo con los campos mapeados; lead Tipo = Cliente + link", async () => {
    const res = await call(CONV, "POST", { id: ids.lead, body: { sigla: "qz" } });
    expect(res.status).toBe(201);
    const cliente = clientes().find((c) => c.id === res.json.clienteId)!;
    expect(cliente.fields).toEqual({
      [C.fields.nombre]: "QA Lead Uno",
      [C.fields.sigla]: "QZ",
      [C.fields.estado]: "Activo",
      [C.fields.contacto]: "QA Contacto",
      [C.fields.telefono]: "+54 9 11 0000-0000",
      [C.fields.mail]: "qa.lead@kairos.test",
      [C.fields.observaciones]: "QA comentario",
    });
    const f = leadRow(ids.lead)!.fields;
    expect(f[L.fields.tipo]).toBe("Cliente");
    expect(f[L.fields.cliente]).toEqual([res.json.clienteId]);
    // El resto del lead queda igual.
    expect(f[L.fields.proyecto]).toBe("Web nueva");
    expect(f[L.fields.ventas]).toBe("QA V");
    expect(CONVERSION_MAP).toEqual({ nombre: "nombre", contacto: "contacto", telefono: "telefono", mail: "mail", comentarios: "observaciones" });
  });

  it.each([
    ["vacía", "", 400, LEAD_MESSAGES.siglaRequerida],
    ["de 1 letra", "Q", 400, MAESTRO_MESSAGES.clienteSiglaFormato],
    ["de 3 letras", "QZA", 400, MAESTRO_MESSAGES.clienteSiglaFormato],
    ["con números", "Q1", 400, MAESTRO_MESSAGES.clienteSiglaFormato],
    ["tomada (otra mayúscula)", "qx", 409, "Ya existe otro registro con este sigla."],
  ] as const)("Sigla %s → %i en el campo Sigla, sin escribir nada", async (_l, sigla, status, mensaje) => {
    const res = await call(CONV, "POST", { id: ids.lead, body: { sigla } });
    expect(res.status).toBe(status);
    expect(res.json.fieldErrors.sigla).toBe(mensaje);
    expect(writes()).toEqual([]);
    expect(leadRow(ids.lead)!.fields[L.fields.tipo]).toBe("Lead");
  });

  it("Nombre ya existe en Clientes → 409 en el campo Nombre, sin escribir nada", async () => {
    leadRow(ids.lead)!.fields[L.fields.nombre] = " qa existente sa ";
    const res = await call(CONV, "POST", { id: ids.lead, body: { sigla: "QZ" } });
    expect(res.status).toBe(409);
    expect(res.json.fieldErrors.nombre).toBe("Ya existe otro registro con este nombre.");
    expect(writes()).toEqual([]);
  });

  it("mail del lead inválido para Clientes → 400 en el mensaje general del diálogo", async () => {
    leadRow(ids.lead)!.fields[L.fields.mail] = "roto@";
    const res = await call(CONV, "POST", { id: ids.lead, body: { sigla: "QZ" } });
    expect(res.status).toBe(400);
    expect(res.json.fieldErrors).toEqual({ general: "Ingresá un email válido." });
    expect(writes()).toEqual([]);
  });

  it("falla el update del lead → se borra el cliente creado y se restaura el lead (503)", async () => {
    fake.failWhen((c, i) => c.method === "update" && c.tableId === L.id && i === 0);
    const antes = clientes().length;
    const res = await call(CONV, "POST", { id: ids.lead, body: { sigla: "QZ" } });
    expect(res.status).toBe(503);
    expect(clientes()).toHaveLength(antes);
    expect(leadRow(ids.lead)!.fields[L.fields.tipo]).toBe("Lead");
    expect(leadRow(ids.lead)!.fields[L.fields.cliente] ?? []).toEqual([]);
  });

  it("falla el update y también el borrado del cliente → 500 y log con los IDs", async () => {
    fake.fail("update", L.id);
    fake.fail("delete", C.id);
    const res = await call(CONV, "POST", { id: ids.lead, body: { sigla: "QZ" } });
    expect(res.status).toBe(500);
    expect(res.json.error).toBe("El cambio quedó incompleto. Avisá a un administrador.");
    const log = vi.mocked(console.error).mock.calls.find((c) => String(c[0]).includes("CAMBIO INCOMPLETO"));
    expect(log?.[1]).toEqual({ lead: ids.lead, cliente: expect.stringMatching(/^rec/) });
  });

  it("la relectura del lead falla → se restaura el lead y se borra el cliente (503)", async () => {
    const antes = clientes().length;
    fake.failWhen((c) => c.method === "list" && c.tableId === L.id && fake.calls.some((x) => x.method === "update" && x.tableId === L.id));
    const res = await call(CONV, "POST", { id: ids.lead, body: { sigla: "QZ" } });
    expect(res.status).toBe(503);
    expect(clientes()).toHaveLength(antes);
    expect(leadRow(ids.lead)!.fields[L.fields.tipo]).toBe("Lead");
    expect(leadRow(ids.lead)!.fields[L.fields.cliente] ?? []).toEqual([]);
  });

  it("otra conversión ganó (el lead apunta a otro cliente) → se borra solo nuestro cliente; el lead no se toca (409)", async () => {
    fake.failWhen((c) => {
      if (c.method === "update" && c.tableId === L.id) {
        queueMicrotask(() => Object.assign(leadRow(ids.lead)!.fields, { [L.fields.cliente]: [ids.cliExistente] }));
      }
      return false;
    });
    const antes = clientes().length;
    const res = await call(CONV, "POST", { id: ids.lead, body: { sigla: "QZ" } });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe(LEAD_MESSAGES.carrera);
    expect(clientes()).toHaveLength(antes);
    expect(leadRow(ids.lead)!.fields[L.fields.cliente]).toEqual([ids.cliExistente]);
  });

  it("ya convertido → 409 sin escribir; una segunda conversión del mismo lead también", async () => {
    expect((await call(CONV, "POST", { id: ids.convertido, body: { sigla: "QZ" } })).status).toBe(409);
    expect(writes()).toEqual([]);
    expect((await call(CONV, "POST", { id: ids.lead, body: { sigla: "QZ" } })).status).toBe(201);
    const n = clientes().length;
    const again = await call(CONV, "POST", { id: ids.lead, body: { sigla: "QW" } });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe(LEAD_MESSAGES.convertido);
    expect(clientes()).toHaveLength(n);
  });

  it("después de convertir: editar → 409; eliminar el lead → 200 y el cliente sigue", async () => {
    const { json } = await call(CONV, "POST", { id: ids.lead, body: { sigla: "QZ" } });
    expect((await call(ONE, "PATCH", { id: ids.lead, body: form() })).status).toBe(409);
    expect((await call(ONE, "DELETE", { id: ids.lead })).status).toBe(200);
    expect(clientes().some((c) => c.id === json.clienteId)).toBe(true);
  });

  it("la lista marca el convertido con su cliente (y sin cliente si ya no existe)", async () => {
    const el = await LeadsPage();
    const byName = Object.fromEntries(el.props.leads.map((l: { values: { nombre: string } }) => [l.values.nombre, l]));
    expect(byName["QA Lead Convertido"]).toMatchObject({ convertido: true, cliente: { id: ids.cliExistente, nombre: "QA Existente SA" } });
    expect(byName["QA Lead Uno"]).toMatchObject({ convertido: false, cliente: null });
    fake.rows(C.id).splice(0);
    const el2 = await LeadsPage();
    expect(el2.props.leads.find((l: { id: string }) => l.id === ids.convertido)).toMatchObject({ convertido: true, cliente: null });
  });
});
