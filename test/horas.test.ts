import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { RESTRICTED_FIELDS, TABLES } from "@/lib/airtable/schema";
import { createFakeAirtable } from "./fake-airtable";

/**
 * Horas, Mis horas y Dashboard por las rutas reales (guards, servicios y
 * reglas) sobre un Airtable falso. Hoy = 12/11/2026 en Buenos Aires.
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
const { HORA_MESSAGES } = await import("@/lib/horas/rules");
const { loadMisHorasPageProps, MisHorasPage } = await import("@/components/horas/server/mis-horas-page");
const { MisHorasManager, SIN_PROYECTOS } = await import("@/components/horas/mis-horas-manager");
const { ToastProvider } = await import("@/components/ui");
const { createMiHora } = await import("@/lib/horas/server/me-service");
const { fechaRangeFormula } = await import("@/lib/horas/server/repo");

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ME_ROUTES = import.meta.glob<Record<string, Handler>>("/app/api/me/**/route.ts", { eager: true });
const ADMIN_ROUTES = import.meta.glob<Record<string, Handler>>("/app/api/admin/{horas,dashboard}/**/route.ts", { eager: true });
const ALL = { ...ME_ROUTES, ...ADMIN_ROUTES };
const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const U = TABLES.usuarios.fields;
const P = TABLES.proyectos;
const C = TABLES.clientes;
const HT = TABLES.horas;
const H = HT.fields;
const VALOR_HORA = 98765.43;
const IMPORTE = 4242424.42;

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("clave-de-prueba", 4);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-12T15:00:00Z") });
});
afterAll(() => vi.useRealTimers());

let ids: Record<string, string>;
beforeEach(() => {
  fake.reset();
  cookieJar.clear();
  clearUserCache();
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const cliente = fake.seed(C.id, { [C.fields.nombre]: "QA Cliente Secreto", [C.fields.sigla]: "QZ", [C.fields.estado]: "Activo" });
  const otroCliente = fake.seed(C.id, { [C.fields.nombre]: "Otro Cliente", [C.fields.sigla]: "OT", [C.fields.estado]: "Activo" });
  const proyecto = (codigo: string, estado: string, c = cliente) =>
    fake.seed(P.id, { [P.fields.codigo]: codigo, [P.fields.estado]: estado, [P.fields.cliente]: [c], [P.fields.valorHora]: VALOR_HORA, [P.fields.monedaValorHora]: "USD" });
  const uno = proyecto("QZ - Uno", "Activo");
  const dos = proyecto("QZ - Dos", "Activo");
  const tres = proyecto("QZ - Tres", "Cerrado");
  const otro = proyecto("OT - Otro", "Activo", otroCliente);
  const user = (nombre: string, rol: string, extra: Record<string, unknown> = {}) =>
    fake.seed(TABLES.usuarios.id, {
      [U.nombre]: nombre,
      [U.email]: `${nombre.toLowerCase()}@kairos.test`,
      [U.rol]: rol,
      [U.sigla]: nombre.slice(0, 2).toUpperCase(),
      [U.estado]: "Activo",
      [U.debeCambiarPassword]: false,
      [U.passwordHash]: hash,
      ...extra,
    });
  const admin = user("Ana", "Admin");
  const eva = user("Eva", "Empleado", { [U.proyectosAsignados]: [uno, tres] });
  const otto = user("Otto", "Empleado", { [U.proyectosAsignados]: [uno, dos] });
  const ines = user("Ines", "Empleado", { [U.estado]: "Inactivo" });
  ids = { cliente, otroCliente, uno, dos, tres, otro, admin, eva, otto, ines };
});

/** Registro de Horas con los campos calculados llenos (como en la base real). */
function seedHora(colaborador: string, proyecto: string, fecha: string, desde: string, hasta: string, extra: Record<string, unknown> = {}) {
  const t = (s: string) => Number(s.slice(0, 2)) * 3600 + Number(s.slice(3, 5)) * 60;
  return fake.seed(HT.id, {
    [H.fecha]: fecha,
    [H.colaborador]: [colaborador],
    [H.proyecto]: [proyecto],
    [H.tarea]: `Tarea ${fecha} ${desde}`,
    [H.horaDesde]: t(desde),
    [H.horaHasta]: t(hasta),
    [H.facturable]: true,
    [H.cargadoPor]: [colaborador],
    [H.valorHora]: [VALOR_HORA],
    [H.moneda]: ["USD"],
    [H.cliente]: [ids.cliente],
    [H.importeAFacturar]: IMPORTE,
    [H.horas]: 999, // la app nunca usa la fórmula de Airtable: calcula con recordHours
    ...extra,
  });
}

async function loginAs(userId: string) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}

async function call(file: string, method: string, opts: { body?: unknown; params?: Record<string, string>; search?: Record<string, string> } = {}) {
  const cookie = cookieJar.get(SESSION_COOKIE);
  const url = new URL("http://localhost/api/x");
  for (const [k, v] of Object.entries(opts.search ?? {})) url.searchParams.set(k, v);
  const req = new NextRequest(url, {
    method,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
  });
  const res = await ALL[`/app/api/${file}`][method](req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

const ME_HORAS = "me/horas/route.ts";
const ME_PROYECTOS = "me/proyectos/route.ts";
const AD_HORAS = "admin/horas/route.ts";
const AD_HORA = "admin/horas/[id]/route.ts";
const AD_DASH = "admin/dashboard/route.ts";
const horaRows = () => fake.rows(HT.id);
const fieldsOf = (id: string) => horaRows().find((r) => r.id === id)!.fields;
const nueva = (over: Record<string, unknown> = {}) => ({ fecha: "2026-11-12", proyecto: ids.uno, tarea: "Diseño", desde: "09:00", hasta: "10:30", ...over });

// ── Estructura de /api/me ─────────────────────────────────────────────────────

describe("/api/me/** (estructura)", () => {
  it("ninguna ruta exporta PATCH, PUT ni DELETE", () => {
    expect(Object.keys(ME_ROUTES).length).toBeGreaterThanOrEqual(2);
    for (const [file, mod] of Object.entries(ME_ROUTES)) {
      for (const m of ["PATCH", "PUT", "DELETE"]) expect(mod[m], `${file} ${m}`).toBeUndefined();
    }
    expect(Object.keys(ME_ROUTES["/app/api/me/horas/route.ts"]).sort()).toEqual(["GET", "POST"]);
    expect(Object.keys(ME_ROUTES["/app/api/me/proyectos/route.ts"])).toEqual(["GET"]);
  });

  it("no existe /api/me/horas/[id] (ni ninguna subruta)", () => {
    const dir = join(process.cwd(), "app/api/me/horas");
    expect(readdirSync(dir)).toEqual(["route.ts"]);
    expect(existsSync(join(dir, "[id]"))).toBe(false);
    expect(Object.keys(ME_ROUTES).filter((k) => k.startsWith("/app/api/me/horas/") && k !== "/app/api/me/horas/route.ts")).toEqual([]);
  });

  it("sin sesión → 401 en todas las rutas de /api/me", async () => {
    for (const [file, mod] of Object.entries(ME_ROUTES)) {
      for (const m of HTTP.filter((x) => mod[x])) {
        expect((await call(file.replace("/app/api/", ""), m, m === "GET" ? {} : { body: {} })).status, `${m} ${file}`).toBe(401);
      }
    }
  });
});

// ── Mis horas: alta ───────────────────────────────────────────────────────────

describe("Mis horas · alta (Empleado)", () => {
  beforeEach(() => loginAs(ids.eva));

  it("Colaborador, Cargado por y Facturable los pone el servidor aunque vengan en el body", async () => {
    const res = await call(ME_HORAS, "POST", {
      body: nueva({ colaborador: [ids.otto], cargadoPor: [ids.otto], facturable: false, mesAFacturar: "2026-12", valorHora: 1, [H.colaborador]: [ids.otto] }),
    });
    expect(res.status).toBe(201);
    expect(fieldsOf(res.json.id)).toEqual({
      [H.fecha]: "2026-11-12",
      [H.proyecto]: [ids.uno],
      [H.tarea]: "Diseño",
      [H.horaDesde]: 32_400,
      [H.horaHasta]: 37_800,
      [H.colaborador]: [ids.eva],
      [H.cargadoPor]: [ids.eva],
      [H.facturable]: true,
    });
  });

  it("fecha futura → 400; hoy en Buenos Aires sí", async () => {
    expect(await call(ME_HORAS, "POST", { body: nueva({ fecha: "2026-11-13" }) })).toMatchObject({
      status: 400,
      json: { error: HORA_MESSAGES.futura, fieldErrors: { fecha: HORA_MESSAGES.futura } },
    });
    expect(HORA_MESSAGES.futura).toBe("No podés cargar horas en una fecha futura.");
    expect((await call(ME_HORAS, "POST", { body: nueva() })).status).toBe(201);
  });

  it("proyecto no asignado → 403; asignado pero Cerrado → 403", async () => {
    for (const proyecto of [ids.dos, ids.tres, ids.otro]) {
      expect(await call(ME_HORAS, "POST", { body: nueva({ proyecto }) })).toMatchObject({ status: 403, json: { error: "No tenés asignado ese proyecto." } });
    }
    expect(fake.calls.some((c) => c.method === "create")).toBe(false);
  });

  it("las asignaciones se releen en cada alta (no se confía en el caché de sesión)", async () => {
    expect((await call(ME_HORAS, "POST", { body: nueva() })).status).toBe(201);
    fake.rows(TABLES.usuarios.id).find((r) => r.id === ids.eva)!.fields[U.proyectosAsignados] = [ids.tres];
    expect((await call(ME_HORAS, "POST", { body: nueva({ desde: "11:00", hasta: "12:00" }) })).status).toBe(403);
  });

  it("validación: obligatorios, hasta > desde, tarea ≤ 1000 → 400", async () => {
    expect((await call(ME_HORAS, "POST", { body: {} })).status).toBe(400);
    expect((await call(ME_HORAS, "POST", { body: nueva({ hasta: "08:00" }) })).json.fieldErrors).toEqual({ hasta: HORA_MESSAGES.rango });
    expect((await call(ME_HORAS, "POST", { body: nueva({ tarea: "x".repeat(1001) }) })).json.fieldErrors).toEqual({ tarea: HORA_MESSAGES.tareaLarga });
  });
});

describe("Superposición", () => {
  beforeEach(() => loginAs(ids.eva));

  it("se pisa → 409 con los rangos; se tocan → OK; otro colaborador u otro día → OK", async () => {
    seedHora(ids.eva, ids.uno, "2026-11-12", "09:00", "10:30");
    seedHora(ids.eva, ids.uno, "2026-11-12", "11:00", "12:00");
    expect(await call(ME_HORAS, "POST", { body: nueva({ desde: "10:00", hasta: "11:30" }) })).toMatchObject({
      status: 409,
      json: { error: "Ese horario se superpone con otro registro del mismo día (09:00–10:30, 11:00–12:00)." },
    });
    expect((await call(ME_HORAS, "POST", { body: nueva({ desde: "10:30", hasta: "11:00" }) })).status).toBe(201); // se tocan
    seedHora(ids.otto, ids.uno, "2026-11-11", "13:00", "15:00");
    expect((await call(ME_HORAS, "POST", { body: nueva({ desde: "13:00", hasta: "15:00", fecha: "2026-11-11" }) })).status).toBe(201); // otro colaborador
    expect((await call(ME_HORAS, "POST", { body: nueva({ desde: "09:00", hasta: "10:30", fecha: "2026-11-10" }) })).status).toBe(201); // otro día
  });

  it("carrera: dos altas que se pisan a la vez → sobrevive exactamente una", async () => {
    fake.barrier("create", HT.id, 2);
    const results = await Promise.all([
      createMiHora(ids.eva, nueva({ desde: "09:00", hasta: "10:00" })),
      createMiHora(ids.eva, nueva({ desde: "09:30", hasta: "10:30" })),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ status: 409, error: expect.stringMatching(/se superpone/) });
    expect(horaRows()).toHaveLength(1);
  });

  it("carrera de edición (Admin): la edición que termina pisándose vuelve a su valor anterior", async () => {
    await loginAs(ids.admin);
    const id = seedHora(ids.eva, ids.uno, "2026-11-12", "08:00", "09:00");
    // Entre el chequeo previo y la verificación, aparece un registro 10:00–11:00.
    fake.failWhen((c) => {
      if (c.method === "update" && c.tableId === HT.id && !horaRows().some((r) => r.fields[H.horaDesde] === 36_000)) seedHora(ids.eva, ids.uno, "2026-11-12", "10:00", "11:00");
      return false;
    });
    const res = await call(AD_HORA, "PATCH", { params: { id }, body: { ...nueva({ desde: "09:30", hasta: "10:30" }), colaborador: ids.eva } });
    expect(res.status).toBe(409);
    expect(fieldsOf(id)[H.horaDesde]).toBe(8 * 3600);
  });
});

// ── F1-04-01 · Superposición: el registro escrito falta en la relectura ────────

describe("Superposición · el registro escrito falta en la relectura (F1-04-01)", () => {
  const verificationLog = () => {
    const entry = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.find((c) => String(c[0]).includes("Verificación posterior fallida"));
    expect(entry).toBeDefined();
    return entry![1];
  };

  it.each([
    ["deshacer OK → 503", false, 503, "No pudimos verificar el cambio. No se modificó nada; probá de nuevo."],
    ["deshacer fallido → 500", true, 500, "El cambio quedó incompleto. Avisá a un administrador."],
  ] as const)("alta (Empleado): %s", async (_l, undoFails, status, error) => {
    await loginAs(ids.eva);
    fake.hide(HT.id, (r) => r.fields[H.tarea] === "Oculta");
    if (undoFails) fake.fail("delete", HT.id);
    const res = await call(ME_HORAS, "POST", { body: nueva({ tarea: "Oculta" }) });
    expect(res).toMatchObject({ status, json: { error } });
    expect(verificationLog()).toEqual({ id: expect.stringMatching(/^rec/), check: "overlap", motivo: "lectura", rollback: undoFails ? "fallido" : "ok" });
    expect(horaRows()).toHaveLength(undoFails ? 1 : 0);
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toMatch(/Oculta|09:00|32400/);
  });

  it.each([
    ["deshacer OK → 503", false, 503],
    ["deshacer fallido → 500", true, 500],
  ] as const)("edición (Admin): %s", async (_l, undoFails, status) => {
    await loginAs(ids.admin);
    const id = seedHora(ids.eva, ids.uno, "2026-11-12", "08:00", "09:00");
    const written = () => fake.calls.some((c) => c.method === "update" && c.tableId === HT.id);
    fake.hide(HT.id, (r) => r.id === id && written());
    if (undoFails) fake.failWhen((c, i) => c.method === "update" && c.tableId === HT.id && i >= 1, new Error("deshacer caído"));
    const res = await call(AD_HORA, "PATCH", { params: { id }, body: { ...nueva({ desde: "13:00", hasta: "14:00" }), colaborador: ids.eva } });
    expect(res.status).toBe(status);
    expect(verificationLog()).toEqual({ id, check: "overlap", motivo: "lectura", rollback: undoFails ? "fallido" : "ok" });
    expect(fieldsOf(id)[H.horaDesde]).toBe(undoFails ? 13 * 3600 : 8 * 3600);
  });
});

// ── Mis horas: lista ─────────────────────────────────────────────────────────

describe("Mis horas · lista (Empleado)", () => {
  beforeEach(() => loginAs(ids.eva));

  it("solo registros propios del período (mes actual por defecto), con el DTO exacto", async () => {
    const a = seedHora(ids.eva, ids.uno, "2026-11-01", "09:00", "10:30");
    const b = seedHora(ids.eva, ids.tres, "2026-11-30", "14:00", "15:20");
    seedHora(ids.eva, ids.uno, "2026-10-31", "09:00", "10:00"); // otro mes
    seedHora(ids.otto, ids.uno, "2026-11-05", "09:00", "17:00"); // otro colaborador
    const res = await call(ME_HORAS, "GET");
    expect(res.status).toBe(200);
    expect(res.json.range).toEqual({ desde: "2026-11-01", hasta: "2026-11-30" });
    expect(res.json.records).toEqual([
      { id: b, fecha: "2026-11-30", proyecto: { id: ids.tres, codigo: "QZ - Tres" }, tarea: "Tarea 2026-11-30 14:00", desde: "14:00", hasta: "15:20", horas: 1.33 },
      { id: a, fecha: "2026-11-01", proyecto: { id: ids.uno, codigo: "QZ - Uno" }, tarea: "Tarea 2026-11-01 09:00", desde: "09:00", hasta: "10:30", horas: 1.5 },
    ]);
    expect(res.json.total).toBe(2.83);
  });

  it("filtro por proyecto: asignado (aunque esté Cerrado) sí; no asignado → 400", async () => {
    seedHora(ids.eva, ids.uno, "2026-11-02", "09:00", "10:00");
    seedHora(ids.eva, ids.tres, "2026-11-03", "09:00", "10:00");
    expect((await call(ME_HORAS, "GET", { search: { proyecto: ids.tres } })).json.records).toHaveLength(1);
    for (const proyecto of [ids.dos, ids.otro, "recNOEXISTE000001"]) {
      expect((await call(ME_HORAS, "GET", { search: { proyecto } })).status).toBe(400);
    }
  });

  it("período inválido → 400", async () => {
    expect((await call(ME_HORAS, "GET", { search: { desde: "2026-11-30", hasta: "2026-11-01" } })).status).toBe(400);
    expect((await call(ME_HORAS, "GET", { search: { desde: "12/11/2026", hasta: "2026-11-30" } })).status).toBe(400);
  });

  it("/api/me/proyectos: solo asignados y Activos, como { id, codigo }", async () => {
    expect((await call(ME_PROYECTOS, "GET")).json).toEqual({ ok: true, proyectos: [{ id: ids.uno, codigo: "QZ - Uno" }] });
  });
});

// ── F1-04-03 · Una foto de asignaciones y proyectos por request ──────────────

describe("Mis horas · lecturas por request (F1-04-03)", () => {
  beforeEach(() => loginAs(ids.eva));
  const reads = () => fake.calls.map((c) => `${c.method}:${c.tableId === TABLES.usuarios.id ? "usuarios" : c.tableId === P.id ? "proyectos" : c.tableId === HT.id ? "horas" : c.tableId}`);

  it("renderizar /mis-horas: guard (1) + usuario, proyectos y horas una vez cada uno", async () => {
    seedHora(ids.eva, ids.uno, "2026-11-03", "09:00", "10:00");
    const element = (await MisHorasPage()) as { props: Awaited<ReturnType<typeof loadMisHorasPageProps>> };
    expect(element.props.initial.records).toHaveLength(1);
    expect(reads().sort()).toEqual(["list:horas", "list:proyectos", "list:usuarios", "list:usuarios"]);
    // La lectura del usuario de la página es por ID (asignaciones), distinta de la del guard (sesión).
    const userReads = fake.calls.filter((c) => c.tableId === TABLES.usuarios.id).map((c) => (c.options as { fields: string[] }).fields);
    expect(userReads).toContainEqual([U.proyectosAsignados, U.estado]);

    // Con la sesión en caché (30 s), un segundo render hace exactamente 3 lecturas.
    fake.calls.length = 0;
    await MisHorasPage();
    expect(reads().sort()).toEqual(["list:horas", "list:proyectos", "list:usuarios"]);
  });

  it("loadMisHorasPageProps sola: 3 lecturas (la lista reusa la foto)", async () => {
    await loadMisHorasPageProps(ids.eva);
    expect(reads().sort()).toEqual(["list:horas", "list:proyectos", "list:usuarios"]);
  });

  it("GET /api/me/horas: 3 lecturas además del guard; el POST vuelve a leer asignación y Estado al escribir", async () => {
    await call(ME_HORAS, "GET"); // calienta el caché de sesión
    fake.calls.length = 0;
    await call(ME_HORAS, "GET");
    expect(reads().sort()).toEqual(["list:horas", "list:proyectos", "list:usuarios"]);
    fake.calls.length = 0;
    expect((await call(ME_HORAS, "POST", { body: nueva() })).status).toBe(201);
    const before = fake.calls.findIndex((c) => c.method === "create");
    expect(reads().slice(0, before)).toEqual(expect.arrayContaining(["list:usuarios", "list:proyectos"]));
  });
});

// ── Exposición de datos (criterio 7) ─────────────────────────────────────────

describe("Mis horas · exposición de datos (criterio 7)", () => {
  beforeEach(() => loginAs(ids.eva));

  const RESTRICTED_KEYS = /valorHora|valor hora|monedaValorHora|moneda|importe|cliente/i;
  function expectClean(text: string, label: string) {
    for (const fieldId of RESTRICTED_FIELDS) expect(text.includes(fieldId), `${label}: ${fieldId}`).toBe(false);
    for (const fieldId of [H.valorHora, H.moneda, H.cliente, H.importeAFacturar, P.fields.valorHora, P.fields.monedaValorHora, P.fields.cliente, H.horas]) {
      expect(text.includes(fieldId), `${label}: ${fieldId}`).toBe(false);
    }
    expect(text, label).not.toMatch(RESTRICTED_KEYS);
    for (const value of ["98765", "98.765", "4242424", "4.242.424", "USD", "QA Cliente Secreto", ids.cliente]) expect(text.includes(value), `${label}: ${value}`).toBe(false);
  }

  it("ninguna respuesta de /api/me, ni la página renderizada, lleva valor hora, moneda, importe o cliente", async () => {
    seedHora(ids.eva, ids.uno, "2026-11-03", "09:00", "12:00");
    const responses = [
      await call(ME_HORAS, "GET"),
      await call(ME_HORAS, "GET", { search: { proyecto: ids.uno } }),
      await call(ME_PROYECTOS, "GET"),
      await call(ME_HORAS, "POST", { body: nueva() }),
      await call(ME_HORAS, "POST", { body: nueva() }), // 409
      await call(ME_HORAS, "POST", { body: nueva({ proyecto: ids.dos }) }), // 403
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 201, 409, 403]);
    responses.forEach((r, i) => expectClean(r.text, `respuesta ${i}`));

    // Página: props que viajan en el payload RSC + HTML renderizado.
    const props = await loadMisHorasPageProps(ids.eva);
    expect(props.initial.records.length).toBe(2);
    expectClean(JSON.stringify(props), "props de /mis-horas");
    const html = renderToStaticMarkup(createElement(ToastProvider, null, createElement(MisHorasManager, props)));
    expect(html).toContain("QZ - Uno");
    expectClean(html, "HTML de /mis-horas");

    // Ni siquiera se le piden esos campos a Airtable. (Usuarios queda afuera: el guard de sesión
    // lee passwordHash en lib/auth/credentials.ts para la huella; nunca sale de ahí.)
    for (const c of fake.calls.filter((x) => x.method === "list" && x.tableId !== TABLES.usuarios.id)) {
      for (const f of (c.options as { fields: string[] }).fields) expect(RESTRICTED_FIELDS.has(f), f).toBe(false);
    }
  });

  it("sin proyectos activos asignados: mensaje y sin formulario", async () => {
    fake.rows(TABLES.usuarios.id).find((r) => r.id === ids.eva)!.fields[U.proyectosAsignados] = [ids.tres];
    const props = await loadMisHorasPageProps(ids.eva);
    const html = renderToStaticMarkup(createElement(ToastProvider, null, createElement(MisHorasManager, props)));
    expect(SIN_PROYECTOS).toBe("Todavía no tenés proyectos asignados. Pedíselo a un administrador.");
    expect(html).toContain(SIN_PROYECTOS);
    expect(html).not.toContain("Cargar horas");
  });
});

// ── Horas (Admin) ────────────────────────────────────────────────────────────

describe("Horas (Admin)", () => {
  beforeEach(() => loginAs(ids.admin));
  const admin = (over: Record<string, unknown> = {}) => ({ ...nueva(), colaborador: ids.eva, ...over });

  it("alta en un proyecto Cerrado, en cualquier fecha (también futura), Cargado por = el admin", async () => {
    const res = await call(AD_HORAS, "POST", { body: admin({ proyecto: ids.tres, fecha: "2027-03-01", cargadoPor: [ids.eva], facturable: false, mesAFacturar: "2027-04" }) });
    expect(res.status).toBe(201);
    expect(fieldsOf(res.json.id)).toMatchObject({
      [H.proyecto]: [ids.tres],
      [H.fecha]: "2027-03-01",
      [H.colaborador]: [ids.eva],
      [H.cargadoPor]: [ids.admin],
      [H.facturable]: false,
      [H.mesAFacturar]: "2027-04-01",
    });
    // Facturable por defecto = sí; sin Mes a facturar no se manda el campo.
    const def = await call(AD_HORAS, "POST", { body: admin({ desde: "15:00", hasta: "16:00" }) });
    expect(fieldsOf(def.json.id)[H.facturable]).toBe(true);
    expect(fieldsOf(def.json.id)).not.toHaveProperty(H.mesAFacturar);
  });

  it("colaborador: Activo en el alta; inactivo o de otra tabla → 400; al editar se puede mantener el inactivo", async () => {
    expect((await call(AD_HORAS, "POST", { body: admin({ colaborador: ids.ines }) })).json.fieldErrors).toEqual({ colaborador: "Elegí un colaborador activo." });
    expect((await call(AD_HORAS, "POST", { body: admin({ colaborador: ids.uno }) })).status).toBe(400);
    expect((await call(AD_HORAS, "POST", { body: admin({ proyecto: ids.eva }) })).json.fieldErrors).toEqual({ proyecto: "Elegí un proyecto válido." });
    const id = seedHora(ids.ines, ids.tres, "2026-10-15", "09:00", "10:00");
    expect((await call(AD_HORA, "PATCH", { params: { id }, body: admin({ colaborador: ids.ines, proyecto: ids.tres, fecha: "2026-10-15", tarea: "Editada" }) })).status).toBe(200);
    expect(fieldsOf(id)[H.tarea]).toBe("Editada");
  });

  it("edición: Cargado por no cambia nunca; Mes a facturar se puede vaciar", async () => {
    const id = seedHora(ids.eva, ids.uno, "2026-11-05", "09:00", "10:00", { [H.cargadoPor]: [ids.eva], [H.mesAFacturar]: "2026-11-01" });
    const res = await call(AD_HORA, "PATCH", { params: { id }, body: admin({ fecha: "2026-11-05", cargadoPor: [ids.admin], [H.cargadoPor]: [ids.admin], mesAFacturar: "" }) });
    expect(res.status).toBe(200);
    expect(fieldsOf(id)[H.cargadoPor]).toEqual([ids.eva]);
    expect(fieldsOf(id)).not.toHaveProperty(H.mesAFacturar);
    const update = fake.calls.find((c) => c.method === "update" && c.tableId === HT.id)!;
    expect(JSON.stringify(update.payload)).not.toContain(H.cargadoPor);
  });

  it("superposición: alta → 409; edición se excluye a sí misma", async () => {
    const id = seedHora(ids.eva, ids.uno, "2026-11-12", "09:00", "10:30");
    expect((await call(AD_HORAS, "POST", { body: admin({ desde: "10:00", hasta: "11:00" }) })).status).toBe(409);
    expect((await call(AD_HORA, "PATCH", { params: { id }, body: admin({ desde: "09:15", hasta: "10:45" }) })).status).toBe(200);
  });

  it("borrado físico; después 404", async () => {
    const id = seedHora(ids.eva, ids.uno, "2026-11-12", "09:00", "10:30");
    expect((await call(AD_HORA, "DELETE", { params: { id } })).status).toBe(200);
    expect(horaRows()).toHaveLength(0);
    expect((await call(AD_HORA, "DELETE", { params: { id } })).status).toBe(404);
    expect((await call(AD_HORA, "PATCH", { params: { id }, body: admin() })).status).toBe(404);
  });

  it("lista: filtros por colaborador, proyecto y cliente (por ID); orden Fecha desc, Desde asc; sin importes", async () => {
    const r1 = seedHora(ids.eva, ids.uno, "2026-11-10", "14:00", "15:00");
    const r2 = seedHora(ids.eva, ids.uno, "2026-11-10", "09:00", "10:00");
    const r3 = seedHora(ids.otto, ids.otro, "2026-11-11", "09:00", "11:00");
    const r4 = seedHora(ids.otto, ids.dos, "2026-11-02", "09:00", "09:30", { [H.mesAFacturar]: "2026-12-01" });
    const all = await call(AD_HORAS, "GET");
    expect(all.json.records.map((r: { id: string }) => r.id)).toEqual([r3, r2, r1, r4]);
    expect(all.json.total).toBe(4.5);
    expect(all.json.records[3]).toMatchObject({
      colaborador: { id: ids.otto, nombre: "Otto" },
      proyecto: { id: ids.dos, codigo: "QZ - Dos", estado: "Activo" },
      cliente: { id: ids.cliente, nombre: "QA Cliente Secreto" },
      facturable: true,
      mesAFacturar: "2026-12-01",
      cargadoPor: { id: ids.otto, nombre: "Otto" },
      horas: 0.5,
    });
    expect((await call(AD_HORAS, "GET", { search: { colaborador: ids.eva } })).json.records).toHaveLength(2);
    expect((await call(AD_HORAS, "GET", { search: { proyecto: ids.otro } })).json.records.map((r: { id: string }) => r.id)).toEqual([r3]);
    expect((await call(AD_HORAS, "GET", { search: { cliente: ids.otroCliente } })).json.total).toBe(2);
    expect((await call(AD_HORAS, "GET", { search: { cliente: "no-es-id" } })).status).toBe(400);
    expect(all.text).not.toMatch(/98765|4242424|USD|valorHora|importe|moneda/);
  });

  it("Empleado → 403 en todas las rutas de Horas y Dashboard de Admin", async () => {
    await loginAs(ids.eva);
    const routes = Object.entries(ADMIN_ROUTES).flatMap(([file, mod]) => HTTP.filter((m) => mod[m]).map((m) => [file.replace("/app/api/", ""), m] as const));
    expect(routes.length).toBe(5);
    for (const [file, m] of routes) {
      expect((await call(file, m, { params: { id: "recXXXXXXXXXXXXXX" }, ...(m === "GET" || m === "DELETE" ? {} : { body: {} }) })).status, `${m} ${file}`).toBe(403);
    }
    expect(fake.calls.some((c) => c.method !== "list")).toBe(false);
  });
});

// ── Dashboard ────────────────────────────────────────────────────────────────

describe("Horas (Admin) · cliente Inactivo (F2-01 v2, fix 6)", () => {
  beforeEach(() => loginAs(ids.admin));

  it("un registro histórico de un proyecto cuyo cliente pasó a Inactivo sigue mostrando el nombre del cliente", async () => {
    const id = seedHora(ids.eva, ids.otro, "2026-10-20", "09:00", "10:00");
    fake.rows(C.id).find((r) => r.id === ids.otroCliente)!.fields[C.fields.estado] = "Inactivo";
    const res = await call(AD_HORAS, "GET", { search: { desde: "2026-10-01", hasta: "2026-10-31" } });
    expect(res.status).toBe(200);
    expect(res.json.records.find((r: { id: string }) => r.id === id).cliente).toEqual({ id: ids.otroCliente, nombre: "Otro Cliente" });
    // y el filtro por ese cliente (por ID) sigue funcionando para ver lo histórico
    expect((await call(AD_HORAS, "GET", { search: { desde: "2026-10-01", hasta: "2026-10-31", cliente: ids.otroCliente } })).json.records).toHaveLength(1);
    const { loadHorasOptions } = await import("@/lib/horas/server/admin-service");
    expect((await loadHorasOptions()).clientes.find((c) => c.id === ids.otroCliente)).toEqual({ id: ids.otroCliente, nombre: "Otro Cliente", activo: false });
  });
});

describe("Dashboard", () => {
  beforeEach(async () => {
    await loginAs(ids.admin);
    // Varios meses, semanas que cruzan el año y minutos que no dan horas "redondas".
    seedHora(ids.eva, ids.uno, "2025-12-30", "09:00", "10:20");
    seedHora(ids.eva, ids.uno, "2026-01-02", "09:00", "09:40");
    seedHora(ids.otto, ids.dos, "2026-01-05", "10:00", "13:07");
    seedHora(ids.otto, ids.otro, "2026-02-28", "08:13", "17:59");
    seedHora(ids.eva, ids.tres, "2026-03-01", "09:01", "09:02");
    seedHora(ids.eva, ids.uno, "2026-03-31", "13:00", "14:00");
  });

  const range = { desde: "2025-12-29", hasta: "2026-03-31" };

  it.each(["diaria", "semanal", "mensual"])("%s: total general = total de la lista de Horas para el mismo filtro", async (agrupacion) => {
    const dash = await call(AD_DASH, "GET", { search: { ...range, agrupacion } });
    const list = await call(AD_HORAS, "GET", { search: range });
    expect(dash.status).toBe(200);
    expect(dash.json.total).toBe(list.json.total);
    expect(dash.json.total).toBe(1.33 + 0.67 + 3.12 + 9.77 + 0.02 + 1);
    // Columnas, filas y total cierran entre sí.
    const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b * 100, 0)) / 100;
    expect(sum(dash.json.columnTotals)).toBe(dash.json.total);
    expect(sum(dash.json.rows.map((r: { total: number }) => r.total))).toBe(dash.json.total);
    for (const r of dash.json.rows) expect(sum(r.values)).toBe(r.total);
    expect(dash.json.buckets[0].desde).toBe(range.desde);
    expect(dash.json.buckets.at(-1).hasta).toBe(range.hasta);
    expect(dash.text).not.toMatch(/98765|4242424|importe|valorHora|moneda/);

    // Con filtro de proyecto, también coincide con la lista filtrada.
    const d1 = await call(AD_DASH, "GET", { search: { ...range, agrupacion, proyectos: ids.uno } });
    const l1 = await call(AD_HORAS, "GET", { search: { ...range, proyecto: ids.uno } });
    expect(d1.json.total).toBe(l1.json.total);
  });

  it("semanal cruzando el año: la semana del 29/12 junta 2025 y 2026", async () => {
    const dash = await call(AD_DASH, "GET", { search: { desde: "2025-12-29", hasta: "2026-01-11", agrupacion: "semanal" } });
    expect(dash.json.buckets.map((b: { label: string }) => b.label)).toEqual(["Sem 29/12", "Sem 05/01"]);
    const uno = dash.json.rows.find((r: { proyecto: { id: string } }) => r.proyecto.id === ids.uno);
    expect(uno.values).toEqual([2, 0]);
  });

  it("filas en 0 se ocultan salvo que el proyecto se haya elegido explícitamente", async () => {
    const def = await call(AD_DASH, "GET", { search: { desde: "2026-01-01", hasta: "2026-01-31" } });
    expect(def.json.rows.map((r: { proyecto: { codigo: string } }) => r.proyecto.codigo)).toEqual(["QZ - Dos", "QZ - Uno"]);
    const sel = await call(AD_DASH, "GET", { search: { desde: "2026-01-01", hasta: "2026-01-31", proyectos: `${ids.uno},${ids.tres}` } });
    expect(sel.json.rows.map((r: { proyecto: { codigo: string }; total: number }) => [r.proyecto.codigo, r.total])).toEqual([
      ["QZ - Tres", 0],
      ["QZ - Uno", 0.67],
    ]);
    // El selector lista todos los proyectos con su Estado.
    expect(sel.json.proyectos.map((p: { codigo: string; estado: string }) => `${p.codigo}:${p.estado}`)).toEqual(["OT - Otro:Activo", "QZ - Dos:Activo", "QZ - Tres:Cerrado", "QZ - Uno:Activo"]);
  });

  it("validaciones: agrupación, proyectos y diaria de más de 400 días → 400", async () => {
    expect((await call(AD_DASH, "GET", { search: { agrupacion: "anual" } })).status).toBe(400);
    expect((await call(AD_DASH, "GET", { search: { proyectos: "recNOEXISTE000001" } })).status).toBe(400);
    expect((await call(AD_DASH, "GET", { search: { desde: "2025-01-01", hasta: "2026-03-01", agrupacion: "diaria" } })).status).toBe(400);
    // Sin parámetros: mes actual y mensual.
    const def = await call(AD_DASH, "GET");
    expect(def.json).toMatchObject({ grouping: "mensual", range: { desde: "2026-11-01", hasta: "2026-11-30" } });
  });
});

describe("Filtro por Fecha (fórmula)", () => {
  it("bordes exclusivos sobre el día anterior y el posterior, por ID de campo", () => {
    expect(String(fechaRangeFormula({ desde: "2026-11-01", hasta: "2026-11-30" }))).toBe(
      `AND({${H.fecha}}, IS_AFTER({${H.fecha}}, "2026-10-31"), IS_BEFORE({${H.fecha}}, "2026-12-01"))`,
    );
  });
});
