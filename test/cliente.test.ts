import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { readFirstSheet } from "@/lib/xlsx/read";
import { createFakeAirtable } from "./fake-airtable";

/**
 * Rol Cliente de punta a punta (rutas, guards, servicios y reglas reales) sobre un
 * Airtable falso: deny by default en TODAS las rutas, alcance por proyectos asignados,
 * lista de campos permitidos, importes = reglas de la Proforma, Excel = pantalla, y las
 * reglas de Usuarios, Proyectos y Horas. Hoy = 12/11/2026 en Buenos Aires. Datos sintéticos.
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
  usePathname: () => "/cliente/horas",
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
const { CLIENTE_MESSAGES, CLIENTE_RESPONSE_KEYS } = await import("@/lib/cliente/types");
const { vistaCliente, tablasImportes, nombreArchivoCliente } = await import("@/lib/cliente/vista");
const { calcularImportesCliente } = await import("@/lib/cliente/importes");
const { cargarProforma } = await import("@/lib/proforma/server/service");
const { calcularProforma } = await import("@/lib/proforma/proforma");
const { ClientePage } = await import("@/components/cliente/server/cliente-page");
const { ClienteHorasView } = await import("@/components/cliente/cliente-horas-view");
const { USUARIO_MESSAGES } = await import("@/lib/abm/usuarios");
const { PROYECTO_MESSAGES } = await import("@/lib/abm/server/maestros-config");
const { HORA_ADMIN_MESSAGES, loadHorasOptions } = await import("@/lib/horas/server/admin-service");
const { valorExcel } = await import("@/lib/reportes/excel");
const { kindDe } = await import("@/lib/reportes/vista");
const { NotFoundContent, NOT_FOUND_TEXT } = await import("@/components/shell/not-found-view");

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ALL_ROUTES = import.meta.glob<Record<string, Handler>>("/app/api/**/route.ts", { eager: true });
const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const U = TABLES.usuarios.fields;
const P = TABLES.proyectos;
const C = TABLES.clientes;
const HT = TABLES.horas;
const H = HT.fields;
const PA = TABLES.parametros.fields;

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("clave-de-prueba", 4);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-12T15:00:00Z") });
});
afterAll(() => vi.useRealTimers());

let ids: Record<string, string>;
const t = (s: string) => Number(s.slice(0, 2)) * 3600 + Number(s.slice(3, 5)) * 60;
function seedHora(colaborador: string, proyecto: string, fecha: string, desde: string, hasta: string, extra: Record<string, unknown> = {}) {
  return fake.seed(HT.id, {
    [H.fecha]: fecha,
    [H.colaborador]: [colaborador],
    [H.proyecto]: [proyecto],
    [H.tarea]: `TAREA-SECRETA ${fecha} ${desde}`,
    [H.horaDesde]: t(desde),
    [H.horaHasta]: t(hasta),
    [H.facturable]: true,
    [H.cargadoPor]: [ids.admin],
    ...extra,
  });
}

beforeEach(() => {
  fake.reset();
  cookieJar.clear();
  clearUserCache();
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const cliA = fake.seed(C.id, { [C.fields.nombre]: "QA Cliente Uno SA", [C.fields.sigla]: "QZ", [C.fields.estado]: "Activo" });
  const cliB = fake.seed(C.id, { [C.fields.nombre]: "QA Otra Empresa", [C.fields.sigla]: "OT", [C.fields.estado]: "Activo" });
  const proyecto = (codigo: string, cliente: string, extra: Record<string, unknown> = {}) =>
    fake.seed(P.id, {
      [P.fields.codigo]: codigo,
      [P.fields.nombreCorto]: codigo.slice(5),
      [P.fields.estado]: "Activo",
      [P.fields.cliente]: [cliente],
      ...extra,
    });
  const alfa = proyecto("QZ - Alfa", cliA, { [P.fields.valorHora]: 1234.57, [P.fields.monedaValorHora]: "ARS" });
  const beta = proyecto("QZ - Beta", cliA, { [P.fields.valorHora]: 50, [P.fields.monedaValorHora]: "USD" });
  const gamma = proyecto("QZ - Gamma", cliA); // sin valor hora ni moneda
  const cerrado = proyecto("QZ - Cerrado", cliA, { [P.fields.estado]: "Cerrado", [P.fields.valorHora]: 10, [P.fields.monedaValorHora]: "ARS" });
  const otro = proyecto("OT - Otro", cliB, { [P.fields.valorHora]: 999, [P.fields.monedaValorHora]: "ARS" });
  const user = (nombre: string, rol: string, extra: Record<string, unknown> = {}) =>
    fake.seed(TABLES.usuarios.id, {
      [U.nombre]: nombre,
      [U.email]: `${nombre.toLowerCase().replace(/ /g, ".")}@kairos.test`,
      [U.rol]: rol,
      [U.estado]: "Activo",
      [U.debeCambiarPassword]: false,
      [U.passwordHash]: hash,
      ...extra,
    });
  const admin = user("Ana Admin", "Admin", { [U.sigla]: "AA" });
  const eva = user("Eva Empleada", "Empleado", { [U.sigla]: "EVQ", [U.proyectosAsignados]: [alfa, beta, otro] });
  const otto = user("Otto Otero", "Empleado", { [U.sigla]: "OOQ", [U.proyectosAsignados]: [alfa, beta] });
  const cli = user("Carla Cliente", "Cliente", { [U.proyectosAsignados]: [alfa, beta] });
  // Link inverso Usuarios del proyecto (en Airtable lo mantiene la base).
  for (const [p, us] of [[alfa, [eva, otto, cli]], [beta, [eva, otto, cli]], [otro, [eva]]] as const) {
    fake.rows(P.id).find((r) => r.id === p)!.fields[P.fields.usuarios] = [...us];
  }
  fake.seed(TABLES.parametros.id, { [PA.concepto]: "Alícuota IVA (proforma de horas)", [PA.valor]: "21%" });
  ids = { cliA, cliB, alfa, beta, gamma, cerrado, otro, admin, eva, otto, cli };

  seedHora(eva, alfa, "2026-11-03", "09:00", "10:20"); // 1,33 h
  seedHora(eva, alfa, "2026-11-04", "09:00", "09:20"); // 0,33 h
  seedHora(otto, alfa, "2026-11-05", "10:00", "12:30"); // 2,5 h
  seedHora(otto, alfa, "2026-11-06", "09:00", "12:00", { [H.facturable]: false }); // no facturable
  seedHora(eva, beta, "2026-11-03", "13:00", "14:00"); // 1 h USD
  seedHora(otto, beta, "2026-11-07", "13:00", "17:00", { [H.facturable]: false }); // no facturable
  seedHora(eva, otro, "2026-11-03", "15:00", "17:00"); // otro cliente
  seedHora(eva, alfa, "2026-10-15", "09:00", "10:00"); // otro mes
});

async function loginAs(userId: string) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}

const routeFile = (key: string) => key.replace(/^\//, "");
async function call(file: string, method: string, opts: { body?: unknown; params?: Record<string, string>; search?: Record<string, string> } = {}) {
  const cookie = cookieJar.get(SESSION_COOKIE);
  const url = new URL("http://localhost/api/x");
  for (const [k, v] of Object.entries(opts.search ?? {})) url.searchParams.set(k, v);
  const req = new NextRequest(url, {
    method,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
  });
  const res = await ALL_ROUTES[`/${file}`][method](req, { params: Promise.resolve(opts.params ?? {}) });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return { status: res.status, text, bytes, json: isJson && text ? JSON.parse(text) : null, headers: res.headers };
}

const VISTA = "app/api/cliente/horas/route.ts";
const EXCEL = "app/api/cliente/horas/excel/route.ts";
const NOV = { desde: "2026-11-01", hasta: "2026-11-30", agrupacion: "mensual" };
const writes = () => fake.calls.filter((c) => c.method !== "list");

// ── A. Deny by default ──────────────────────────────────────────────────────

const endpoints = Object.entries(ALL_ROUTES).flatMap(([key, mod]) =>
  HTTP.filter((m) => typeof mod[m] === "function").map((m) => ({ file: routeFile(key), method: m })),
);
/** Lo único que un Cliente puede llamar: auth (login, logout, cambio de contraseña, expirada) y app/api/cliente/**. */
const allowedForCliente = (file: string) => file.startsWith("app/api/auth/") || file.startsWith("app/api/cliente/");
const PARAMS = { tabla: "unidades-de-negocio", id: "recXXXXXXXXXXXXXX", reporte: "resultados", transferencia: "TR-x" };

describe("A. Cliente: deny by default en TODAS las rutas", () => {
  it("la enumeración encuentra todas las rutas (admin, me, auth, cliente)", () => {
    const files = new Set(endpoints.map((e) => e.file));
    expect(endpoints.length).toBeGreaterThanOrEqual(39);
    for (const prefix of ["app/api/admin/", "app/api/me/", "app/api/auth/", "app/api/cliente/"]) expect([...files].some((f) => f.startsWith(prefix))).toBe(true);
    expect(endpoints.filter((e) => !allowedForCliente(e.file)).length).toBeGreaterThanOrEqual(33);
  });

  it.each(endpoints.filter((e) => !allowedForCliente(e.file)))("$method $file con sesión Cliente → 403, sin escribir", async ({ file, method }) => {
    await loginAs(ids.cli);
    const res = await call(file, method, { body: method === "GET" || method === "DELETE" ? undefined : {}, params: PARAMS });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: "No tenés permiso para hacer esto." });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(writes()).toEqual([]);
  });

  it.each(endpoints.filter((e) => e.file.startsWith("app/api/cliente/")))("$method $file: Admin y Empleado → 403; sin sesión → 401", async ({ file, method }) => {
    for (const who of [ids.admin, ids.eva]) {
      await loginAs(who);
      const res = await call(file, method, { search: NOV });
      expect(res.status).toBe(403);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    cookieJar.clear();
    expect((await call(file, method, { search: NOV })).status).toBe(401);
  });

  it("el cambio de contraseña sí lo puede usar un Cliente", async () => {
    await loginAs(ids.cli);
    const res = await call("app/api/auth/password/route.ts", "POST", { body: { actual: "mal", nueva: "x", repetir: "x" } });
    expect(res.status).not.toBe(403);
  });
});

// ── C. Vista Cliente ────────────────────────────────────────────────────────

/** Todas las claves de un JSON, en cualquier nivel. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysOf(x, out);
    }
  }
  return out;
}

describe("C. Alcance y datos", () => {
  beforeEach(() => loginAs(ids.cli));

  it("solo los 2 proyectos asignados, solo horas facturables, con valor hora y detalle por colaborador", async () => {
    const res = await call(VISTA, "GET", { search: NOV });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const d = res.json;
    expect(d.proyectos).toEqual([
      { id: ids.alfa, codigo: "QZ - Alfa" },
      { id: ids.beta, codigo: "QZ - Beta" },
    ]);
    expect(d.rows.map((r: { proyecto: { codigo: string }; total: number }) => [r.proyecto.codigo, r.total])).toEqual([
      ["QZ - Alfa", 4.16],
      ["QZ - Beta", 1],
    ]);
    expect(d.total).toBe(5.16);
    expect(d.columnTotals).toEqual([5.16]);
    const [alfa, beta] = d.importes.proyectos;
    expect(alfa).toMatchObject({ codigo: "QZ - Alfa", valorHora: 1234.57, moneda: "ARS", horas: 4.16 });
    expect(alfa.colaboradores).toEqual([
      { nombre: "Eva Empleada", horas: 1.66, neto: 164198 + 40741 },
      { nombre: "Otto Otero", horas: 2.5, neto: 308643 },
    ]);
    expect(alfa.neto).toBe(164198 + 40741 + 308643);
    expect(beta).toMatchObject({ moneda: "USD", horas: 1, neto: 5000, iva: 1050, total: 6050 });
    // Nada del otro cliente ni de lo no facturable
    expect(res.text).not.toContain("OT - Otro");
    expect(res.text).not.toContain(ids.otro);
    expect(res.text).not.toContain("QA Otra Empresa");
  });

  it("la vista diaria agrupa por día y respeta el rango por Fecha", async () => {
    const d = (await call(VISTA, "GET", { search: { desde: "2026-11-03", hasta: "2026-11-04", agrupacion: "diaria" } })).json;
    expect(d.buckets.map((b: { key: string }) => b.key)).toEqual(["2026-11-03", "2026-11-04"]);
    expect(d.rows[0].values).toEqual([1.33, 0.33]);
    expect(d.rows[1].values).toEqual([1, 0]);
  });

  it("un proyecto no asignado (otro cliente) → 403 con el mensaje; también en el Excel", async () => {
    for (const file of [VISTA, EXCEL]) {
      const res = await call(file, "GET", { search: { ...NOV, proyectos: ids.otro } });
      expect(res.status).toBe(403);
      expect(res.json).toEqual({ error: "Este proyecto no está asignado a tu usuario." });
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.text).not.toContain("OT - Otro");
    }
    // mezclado con uno propio, igual se rechaza
    expect((await call(VISTA, "GET", { search: { ...NOV, proyectos: `${ids.alfa},${ids.otro}` } })).status).toBe(403);
  });

  it("filtrar por uno de sus proyectos muestra solo ese", async () => {
    const d = (await call(VISTA, "GET", { search: { ...NOV, proyectos: ids.beta } })).json;
    expect(d.selected).toEqual([ids.beta]);
    expect(d.rows.map((r: { proyecto: { id: string } }) => r.proyecto.id)).toEqual([ids.beta]);
    expect(d.importes.totales).toEqual([{ moneda: "USD", neto: 5000, iva: 1050, total: 6050 }]);
  });

  it("las asignaciones se leen de Airtable en cada request (sin re-login)", async () => {
    expect((await call(VISTA, "GET", { search: NOV })).json.proyectos).toHaveLength(2);
    fake.rows(TABLES.usuarios.id).find((r) => r.id === ids.cli)!.fields[U.proyectosAsignados] = [ids.alfa];
    const d = (await call(VISTA, "GET", { search: NOV })).json;
    expect(d.proyectos).toEqual([{ id: ids.alfa, codigo: "QZ - Alfa" }]);
    expect((await call(VISTA, "GET", { search: { ...NOV, proyectos: ids.beta } })).status).toBe(403);
  });

  it("filtros inválidos → 400 (sin datos)", async () => {
    expect((await call(VISTA, "GET", { search: { ...NOV, agrupacion: "trimestral" } })).status).toBe(400);
    expect((await call(VISTA, "GET", { search: { ...NOV, proyectos: "no-es-id" } })).status).toBe(400);
  });
});

describe("C.5 Lista de campos permitidos", () => {
  beforeEach(() => loginAs(ids.cli));

  it("ninguna respuesta de app/api/cliente trae otra clave ni datos por registro", async () => {
    const responses = [
      await call(VISTA, "GET", { search: NOV }),
      await call(VISTA, "GET", { search: { desde: "2026-11-01", hasta: "2026-11-30", agrupacion: "diaria" } }),
      await call(VISTA, "GET", { search: { ...NOV, proyectos: ids.otro } }),
      await call(VISTA, "GET", { search: { ...NOV, agrupacion: "x" } }),
      await call(EXCEL, "GET", { search: { ...NOV, proyectos: ids.otro } }),
    ];
    const horaIds = fake.rows(HT.id).map((r) => r.id);
    const userIds = fake.rows(TABLES.usuarios.id).map((r) => r.id);
    for (const r of responses) {
      const extra = [...keysOf(r.json)].filter((k) => !CLIENTE_RESPONSE_KEYS.has(k));
      expect(extra, r.text).toEqual([]);
      for (const secret of [...horaIds, ...userIds, "TAREA-SECRETA", "@kairos.test", "EVQ", "OOQ", "QA Cliente Uno SA", "Alícuota", "0.21", "21%", "fld", "tbl"]) {
        expect(r.text).not.toContain(secret);
      }
    }
  });
});

describe("C.4 Importes: reglas de la Proforma", () => {
  beforeEach(() => loginAs(ids.cli));

  it("los importes por proyecto y por moneda son los de la Proforma para los mismos registros", async () => {
    // Todo el cliente QZ con horas en 11/2026 está asignado (Gamma no tiene horas) → mismos registros.
    const d = (await call(VISTA, "GET", { search: NOV })).json;
    const prof = await cargarProforma({ cliente: ids.cliA, mes: "2026-11" });
    expect(prof.ok).toBe(true);
    if (!prof.ok) return;
    const porId = new Map(prof.data.proyectos.map((p) => [p.id, p]));
    for (const p of d.importes.proyectos) {
      expect(p.neto).toBe(porId.get(p.id)!.importe);
      expect(p.horas).toBe(porId.get(p.id)!.horas);
    }
    expect(d.importes.totales).toEqual(prof.data.totales.map((x) => ({ moneda: x.moneda, neto: x.subtotal, iva: x.iva, total: x.total })));
  });

  it("los netos de los colaboradores suman exactamente el neto del proyecto (redondeo por registro)", () => {
    // 3 registros de 0,33 h × 1234,57: por registro 407,41 → 1.222,23 (≠ 0,99 h × 1234,57 = 1.222,22)
    const horas = [
      { proyecto: "p", colaborador: "a", horas: 0.33 },
      { proyecto: "p", colaborador: "a", horas: 0.33 },
      { proyecto: "p", colaborador: "b", horas: 0.33 },
    ];
    const r = calcularImportesCliente({
      proyectos: [{ id: "p", codigo: "QZ - P", cliente: "c", valorHora: 1234.57, moneda: "ARS" }],
      horas,
      colaboradores: new Map([["a", "Ana"], ["b", "Beto"]]),
      alicuota: 0.21,
    });
    const p = r.proyectos[0];
    expect(p.colaboradores.map((c) => c.neto)).toEqual([81482, 40741]);
    expect(p.neto).toBe(122223);
    expect(p.colaboradores.reduce((n, c) => n + c.neto!, 0)).toBe(p.neto);
    // igual que calcularProforma con esos registros
    const prof = calcularProforma({
      cliente: { id: "c", nombre: "C", sigla: "QZ", cuit: null, condicionIva: null },
      mes: "2026-11",
      alicuota: 0.21,
      proyectos: [{ id: "p", codigo: "QZ - P", cliente: "c", valorHora: 1234.57, moneda: "ARS" }],
      horas: horas.map((h, i) => ({ id: `h${i}`, fecha: "2026-11-02", colaborador: h.colaborador, proyecto: "p", tarea: "", desde: 0, hasta: 1200, facturable: true, mesAFacturar: null })),
      colaboradores: new Map(),
    });
    expect(prof.proyectos[0].importe).toBe(p.neto);
    expect(r.totales).toEqual(prof.totales.map((x) => ({ moneda: x.moneda, neto: x.subtotal, iva: x.iva, total: x.total })));
  });

  it("las horas no facturables no cuentan en nada (horas, totales, barras, detalle, importes)", async () => {
    const d = (await call(VISTA, "GET", { search: NOV })).json;
    const otto = d.importes.proyectos[0].colaboradores.find((c: { nombre: string }) => c.nombre === "Otto Otero");
    expect(otto.horas).toBe(2.5); // sin las 3 h no facturables
    expect(d.importes.proyectos[1].colaboradores.map((c: { nombre: string }) => c.nombre)).toEqual(["Eva Empleada"]);
    expect(d.total).toBe(5.16);
  });

  it("nunca suma monedas distintas: un total por moneda", async () => {
    const d = (await call(VISTA, "GET", { search: NOV })).json;
    expect(d.importes.totales.map((x: { moneda: string }) => x.moneda)).toEqual(["ARS", "USD"]);
    const ars = 164198 + 40741 + 308643;
    expect(d.importes.totales[0]).toEqual({ moneda: "ARS", neto: ars, iva: Math.round(ars * 0.21), total: ars + Math.round(ars * 0.21) });
  });

  it("fallback: proyecto sin valor hora → «Importe no disponible» y fuera de los totales", async () => {
    fake.rows(TABLES.usuarios.id).find((r) => r.id === ids.cli)!.fields[U.proyectosAsignados] = [ids.alfa, ids.gamma];
    seedHora(ids.eva, ids.gamma, "2026-11-09", "09:00", "11:00");
    const d = (await call(VISTA, "GET", { search: NOV })).json;
    const gamma = d.importes.proyectos.find((p: { codigo: string }) => p.codigo === "QZ - Gamma");
    expect(gamma).toMatchObject({ horas: 2, valorHora: null, moneda: null, neto: null, iva: null, total: null });
    expect(d.importes.totales).toHaveLength(1);
    expect(d.importes.totales[0].neto).toBe(164198 + 40741 + 308643);
    const tablas = tablasImportes(d);
    expect(tablas[0].filas.find((f) => f.cells[0] === "QZ - Gamma")!.cells).toEqual(["QZ - Gamma", null, null, 2, "Importe no disponible", null, null]);
  });

  it.each([
    ["solo falta la Moneda", { [P.fields.valorHora]: 80 }, 80, null],
    ["solo falta el Valor hora", { [P.fields.monedaValorHora]: "USD" }, null, "USD"],
  ])("fallback: %s → se muestra lo que hay, «Importe no disponible» (API, vista y Excel)", async (_n, fields, valorHora, moneda) => {
    Object.assign(fake.rows(P.id).find((r) => r.id === ids.gamma)!.fields, fields);
    fake.rows(TABLES.usuarios.id).find((r) => r.id === ids.cli)!.fields[U.proyectosAsignados] = [ids.alfa, ids.gamma];
    seedHora(ids.eva, ids.gamma, "2026-11-09", "09:00", "11:00");
    const d = (await call(VISTA, "GET", { search: NOV })).json;
    const gamma = d.importes.proyectos.find((p: { codigo: string }) => p.codigo === "QZ - Gamma");
    expect(gamma).toMatchObject({ horas: 2, valorHora, moneda, neto: null, iva: null, total: null });
    expect(d.importes.totales.map((t: { moneda: string; neto: number }) => [t.moneda, t.neto])).toEqual([["ARS", 164198 + 40741 + 308643]]);
    const fila = tablasImportes(d)[0].filas.find((f) => f.cells[0] === "QZ - Gamma")!;
    expect(fila.cells).toEqual(["QZ - Gamma", valorHora === null ? null : valorHora * 100, moneda, 2, "Importe no disponible", null, null]);
    const xl = await call(EXCEL, "GET", { search: NOV });
    const row = readFirstSheet(xl.bytes).find((r) => r[0] === "QZ - Gamma" && r.length > 3)!;
    const trim = (r: unknown[]) => { const o = [...r]; while (o.length && o[o.length - 1] == null) o.pop(); return o; };
    expect(trim(row)).toEqual(trim(["QZ - Gamma", valorHora, moneda, 2, "Importe no disponible", null, null]));
    expect([...keysOf(d)].filter((k) => !CLIENTE_RESPONSE_KEYS.has(k))).toEqual([]);
  });

  it("fallback: alícuota inválida → horas sí, importes reemplazados por el aviso (sin nombrar el Parámetro)", async () => {
    fake.rows(TABLES.parametros.id)[0].fields[PA.valor] = "mucho";
    const res = await call(VISTA, "GET", { search: NOV });
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(5.16);
    expect(res.json.importes).toBeNull();
    const tablas = tablasImportes(res.json);
    expect(tablas).toEqual([{ titulo: "Importes", columnas: [], filas: [], error: "No pudimos calcular el importe. Consultá con Agencia Kairos." }]);
    expect(JSON.stringify(vistaCliente(res.json))).not.toMatch(/Par[aá]metro|Alícuota/);
  });
});

// ── C.1 Página: nunca una página de error ───────────────────────────────────

async function renderPage(search: Record<string, string>) {
  const el = await ClientePage({ searchParams: Promise.resolve(search) });
  expect(isValidElement(el)).toBe(true);
  const props = (el as ReactElement<{ initial: unknown; aviso: string | null }>).props;
  const html = renderToStaticMarkup(createElement(ClienteHorasView, props as Parameters<typeof ClienteHorasView>[0]));
  return { props, html };
}

describe("C.1 Página de la vista Cliente", () => {
  beforeEach(() => loginAs(ids.cli));

  it("con datos: tabla, importes, detalle por colaborador y Descargar Excel", async () => {
    const { html } = await renderPage(NOV);
    for (const s of ["Horas por proyecto", "QZ - Alfa", "QZ - Beta", "Importes por proyecto", "Detalle por colaborador · QZ - Alfa", "Eva Empleada", "Totales por moneda", "Descargar Excel"]) {
      expect(html).toContain(s);
    }
    expect(html).not.toContain("OT - Otro");
    expect(html).not.toContain("TAREA-SECRETA");
  });

  it("link a un proyecto no asignado: muestra «no está asignado» y la vista de sus proyectos (no una página de error)", async () => {
    const { props, html } = await renderPage({ ...NOV, proyectos: ids.otro });
    expect(props.aviso).toBe(CLIENTE_MESSAGES.noAsignado);
    expect(html).toContain("Este proyecto no está asignado a tu usuario.");
    // Aviso neutro (como «No tenés proyectos asignados…»), no el rojo de error.
    expect(html).toMatch(/role="status" class="[^"]*border-line[^"]*"(?:(?!role=)[\s\S])*Este proyecto no está asignado a tu usuario\./);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toMatch(/text-danger/);
    expect(html).toContain("QZ - Alfa");
    expect(html).toContain("QZ - Beta");
    expect(html).not.toContain("OT - Otro");
  });

  it("sin proyectos asignados: «No tenés proyectos asignados…»", async () => {
    fake.rows(TABLES.usuarios.id).find((r) => r.id === ids.cli)!.fields[U.proyectosAsignados] = [];
    const { html } = await renderPage({});
    expect(html).toContain("No tenés proyectos asignados. Consultá con Agencia Kairos.");
    expect(html).not.toContain("Descargar Excel");
  });

  it("Admin y Empleado que abren la vista Cliente van a su inicio", async () => {
    await loginAs(ids.admin);
    await expect(ClientePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT /dashboard");
    clearUserCache();
    await loginAs(ids.eva);
    await expect(ClientePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT /mis-horas");
  });
});

// ── C.6 Excel = pantalla ────────────────────────────────────────────────────

describe("C.6 Descargar Excel", () => {
  beforeEach(() => loginAs(ids.cli));

  it("celda por celda igual al objeto de la pantalla (horas + importes + detalle por colaborador)", async () => {
    const search = { desde: "2026-11-01", hasta: "2026-11-14", agrupacion: "semanal" };
    const screen = (await call(VISTA, "GET", { search })).json;
    const xl = await call(EXCEL, "GET", { search });
    expect(xl.status).toBe(200);
    expect(xl.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(xl.headers.get("content-disposition")).toBe('attachment; filename="Horas_Proyectos_2026-11-01_2026-11-14.xlsx"');
    expect(xl.headers.get("cache-control")).toBe("no-store");

    // Hoja esperada armada a mano desde el objeto de la pantalla (independiente de vistaToSheet).
    const m = (c: number | null) => (c === null ? null : c / 100);
    const expected: (string | number | null)[][] = [
      ["Horas"],
      ["01/11/2026 al 14/11/2026 · Agrupación semanal"],
      ["Proyectos: QZ - Alfa, QZ - Beta"],
      ["Solo horas facturables."],
      [],
      ["Horas por proyecto"],
      ["Proyecto", ...screen.buckets.map((b: { label: string }) => b.label), "Total"],
      ...screen.rows.map((r: { proyecto: { codigo: string }; values: number[]; total: number }) => [r.proyecto.codigo, ...r.values, r.total]),
      ["Total", ...screen.columnTotals, screen.total],
      [],
      ["Importes por proyecto"],
      ["Proyecto", "Valor hora", "Moneda", "Horas", "Neto", "IVA", "Total"],
      ...screen.importes.proyectos.map((p: { codigo: string; valorHora: number; moneda: string; horas: number; neto: number; iva: number; total: number }) => [
        p.codigo,
        p.valorHora,
        p.moneda,
        p.horas,
        m(p.neto),
        m(p.iva),
        m(p.total),
      ]),
      ...screen.importes.proyectos.flatMap((p: { codigo: string; moneda: string; horas: number; neto: number; colaboradores: { nombre: string; horas: number; neto: number }[] }) => [
        [],
        [`Detalle por colaborador · ${p.codigo}`],
        ["Colaborador", "Horas", `Neto (${p.moneda})`],
        ...p.colaboradores.map((c) => [c.nombre, c.horas, m(c.neto)]),
        [`Total ${p.codigo}`, p.horas, m(p.neto)],
      ]),
      [],
      ["Totales por moneda"],
      ["Moneda", "Neto", "IVA", "Total"],
      ...screen.importes.totales.map((x: { moneda: string; neto: number; iva: number; total: number }) => [x.moneda, m(x.neto), m(x.iva), m(x.total)]),
    ];
    const trim = (r: unknown[]) => {
      const out = [...r];
      while (out.length && (out[out.length - 1] === null || out[out.length - 1] === undefined)) out.pop();
      return out;
    };
    const rows = readFirstSheet(xl.bytes).map(trim);
    expect(rows).toEqual(expected.map(trim));
    // y coincide con la vista que dibuja la pantalla
    const vista = vistaCliente(screen);
    const fromVista = vista.tablas.flatMap((tb) => tb.filas.map((f) => trim(tb.columnas.map((c, i) => valorExcel(kindDe(c, f), f.cells[i] ?? null)))));
    for (const r of fromVista) expect(rows).toContainEqual(r);
    // los números son números
    expect(typeof rows[7][1]).toBe("number");
  });

  it("Anual: 2 columnas «AAAA» con los mismos totales que Mensual, en pantalla y en el Excel", async () => {
    seedHora(ids.eva, ids.alfa, "2025-12-30", "09:00", "11:00"); // 2 h en 2025
    seedHora(ids.otto, ids.beta, "2025-11-30", "09:00", "10:00"); // fuera del rango
    const search = { desde: "2025-12-01", hasta: "2026-11-30", agrupacion: "anual" };
    const anual = (await call(VISTA, "GET", { search })).json;
    const mensual = (await call(VISTA, "GET", { search: { ...search, agrupacion: "mensual" } })).json;
    expect(anual.grouping).toBe("anual");
    expect(anual.buckets.map((b: { label: string }) => b.label)).toEqual(["2025", "2026"]);
    expect(anual.total).toBe(mensual.total);
    const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b * 100, 0)) / 100;
    const porAnio = (values: number[]) => ["2025", "2026"].map((y) => sum(values.filter((_, i) => mensual.buckets[i].key.startsWith(y))));
    expect(anual.columnTotals).toEqual(porAnio(mensual.columnTotals));
    anual.rows.forEach((r: { total: number; values: number[] }, i: number) => {
      expect(r.total).toBe(mensual.rows[i].total);
      expect(r.values).toEqual(porAnio(mensual.rows[i].values));
    });
    expect(anual.rows.map((r: { proyecto: { codigo: string }; values: number[] }) => [r.proyecto.codigo, r.values])).toEqual([
      ["QZ - Alfa", [2, 1.33 + 0.33 + 2.5 + 1]],
      ["QZ - Beta", [0, 1]],
    ]);
    // Importes: los mismos registros que Mensual.
    expect(anual.importes).toEqual(mensual.importes);

    const xl = await call(EXCEL, "GET", { search });
    expect(xl.status).toBe(200);
    const rows = readFirstSheet(xl.bytes);
    expect(rows[1][0]).toBe("01/12/2025 al 30/11/2026 · Agrupación anual");
    expect(rows[6].slice(0, 4)).toEqual(["Proyecto", "2025", "2026", "Total"]);
    expect(rows[7].slice(0, 4)).toEqual(["QZ - Alfa", 2, 5.16, 7.16]);
    expect(rows[9].slice(0, 4)).toEqual(["Total", ...anual.columnTotals, anual.total]);
  });

  it("nombre del archivo: el Código si la vista es de un solo proyecto", async () => {
    const xl = await call(EXCEL, "GET", { search: { ...NOV, proyectos: ids.alfa } });
    expect(xl.headers.get("content-disposition")).toBe('attachment; filename="Horas_QZ-Alfa_2026-11-01_2026-11-30.xlsx"');
    expect(nombreArchivoCliente({ ...(await call(VISTA, "GET", { search: NOV })).json, rows: [] })).toBe("Horas_Proyectos_2026-11-01_2026-11-30.xlsx");
  });
});

// ── B. Usuarios ─────────────────────────────────────────────────────────────

const USUARIOS = "app/api/admin/usuarios/route.ts";
const USUARIO = "app/api/admin/usuarios/[id]/route.ts";
const ESTADO = "app/api/admin/usuarios/[id]/estado/route.ts";
const nuevoCliente = (over: Record<string, unknown> = {}) => ({
  nombre: "Nuevo Cliente",
  email: "nuevo.cliente@kairos.test",
  rol: "Cliente",
  sigla: "",
  socio: [],
  proyectosAsignados: [ids.alfa, ids.beta],
  password: "Temporal-Segura-1",
  ...over,
});

describe("B. Usuarios con Rol Cliente", () => {
  beforeEach(() => loginAs(ids.admin));

  it("alta válida: sin sigla, proyectos del mismo cliente con valor hora", async () => {
    const res = await call(USUARIOS, "POST", { body: nuevoCliente() });
    expect(res.status).toBe(201);
    const f = fake.rows(TABLES.usuarios.id).find((r) => r.id === res.json.id)!.fields;
    expect(f).toMatchObject({ [U.rol]: "Cliente", [U.proyectosAsignados]: [ids.alfa, ids.beta], [U.socio]: [] });
  }, 30_000);

  it.each([
    ["sin proyectos", [], USUARIO_MESSAGES.clienteSinProyectos],
    ["proyectos de dos clientes", ["alfa", "otro"], USUARIO_MESSAGES.clienteMismoCliente],
    ["proyecto sin valor hora ni moneda", ["alfa", "gamma"], USUARIO_MESSAGES.clienteSinValorHora],
    ["proyecto no Activo", ["cerrado"], "Elegí una opción válida."],
  ])("alta rechazada: %s", async (_name, proyectos, mensaje) => {
    const res = await call(USUARIOS, "POST", { body: nuevoCliente({ proyectosAsignados: (proyectos as string[]).map((k) => ids[k]) }) });
    expect(res.status).toBe(400);
    expect(res.json.fieldErrors.proyectosAsignados).toBe(mensaje);
    expect(writes()).toEqual([]);
  });

  it("alta rechazada: con Socio", async () => {
    const socio = fake.seed(TABLES.socios.id, { [TABLES.socios.fields.sigla]: "SO", [TABLES.socios.fields.nombre]: "Socio" });
    const res = await call(USUARIOS, "POST", { body: nuevoCliente({ socio: [socio] }) });
    expect(res.status).toBe(400);
    expect(res.json.fieldErrors.socio).toBe(USUARIO_MESSAGES.clienteSocio);
    expect(writes()).toEqual([]);
  });

  it("cambio de rol aplica las reglas del rol nuevo (Empleado → Cliente y Cliente → Empleado)", async () => {
    const base = { nombre: "Eva Empleada", email: "eva.empleada@kairos.test", sigla: "EVQ", socio: [] };
    // Eva tiene un proyecto de otro cliente: como Cliente no puede
    const a = await call(USUARIO, "PATCH", { params: { id: ids.eva }, body: { ...base, rol: "Cliente", proyectosAsignados: [ids.alfa, ids.otro] } });
    expect(a.status).toBe(400);
    expect(a.json.fieldErrors.proyectosAsignados).toBe(USUARIO_MESSAGES.clienteMismoCliente);
    // un proyecto que ya tenía como Empleado pero que no es elegible para Cliente (Cerrado) no se conserva
    fake.rows(TABLES.usuarios.id).find((r) => r.id === ids.eva)!.fields[U.proyectosAsignados] = [ids.alfa, ids.cerrado];
    const b = await call(USUARIO, "PATCH", { params: { id: ids.eva }, body: { ...base, rol: "Cliente", proyectosAsignados: [ids.alfa, ids.cerrado] } });
    expect(b.status).toBe(400);
    const ok = await call(USUARIO, "PATCH", { params: { id: ids.eva }, body: { ...base, rol: "Cliente", proyectosAsignados: [ids.alfa] } });
    expect(ok.status).toBe(200);
    // Cliente → Empleado: la sigla vuelve a ser obligatoria
    const c = await call(USUARIO, "PATCH", { params: { id: ids.cli }, body: { nombre: "Carla Cliente", email: "carla.cliente@kairos.test", rol: "Empleado", sigla: "", socio: [], proyectosAsignados: [ids.alfa] } });
    expect(c.status).toBe(400);
    expect(c.json.fieldErrors.sigla).toBe("Este campo es obligatorio.");
  });

  describe("cambio a Cliente de un usuario con horas", () => {
    const body = (nombre: string, email: string, sigla: string) => ({ nombre, email, rol: "Cliente", sigla, socio: [], proyectosAsignados: [ids.alfa] });
    const setUser = (id: string, f: Record<string, unknown>) => Object.assign(fake.rows(TABLES.usuarios.id).find((r) => r.id === id)!.fields, f);
    const horaDe = (id: string) => fake.rows(HT.id).find((r) => (r.fields[H.colaborador] as string[])[0] === id)!.id;

    it.each([
      ["como Colaborador", "horasReverse"],
      ["como Cargado por", "horas2Reverse"],
    ])("con horas %s → 409 con el mensaje en Rol; nada escrito", async (_n, campo) => {
      setUser(ids.eva, { [U[campo as "horasReverse"]]: [horaDe(ids.eva)] });
      const res = await call(USUARIO, "PATCH", { params: { id: ids.eva }, body: body("Eva Empleada", "eva.empleada@kairos.test", "EVQ") });
      expect(res.status).toBe(409);
      expect(res.json).toEqual({ error: USUARIO_MESSAGES.clienteConHoras, fieldErrors: { rol: USUARIO_MESSAGES.clienteConHoras } });
      expect(USUARIO_MESSAGES.clienteConHoras).toBe("Este usuario tiene horas cargadas: no se puede cambiar a Cliente.");
      expect(writes()).toEqual([]);
    });

    it("también desde Admin; sin horas sí se puede; crear un Cliente nuevo no cambia", async () => {
      setUser(ids.admin, { [U.horas2Reverse]: [horaDe(ids.eva)] });
      const otroAdmin = fake.seed(TABLES.usuarios.id, { [U.nombre]: "Bea Admin", [U.email]: "bea@kairos.test", [U.rol]: "Admin", [U.estado]: "Activo", [U.sigla]: "BB", [U.horas2Reverse]: [horaDe(ids.otto)] });
      expect((await call(USUARIO, "PATCH", { params: { id: otroAdmin }, body: body("Bea Admin", "bea@kairos.test", "BB") })).status).toBe(409);
      const sinHoras = fake.seed(TABLES.usuarios.id, { [U.nombre]: "Sin Horas", [U.email]: "sin.horas@kairos.test", [U.rol]: "Empleado", [U.estado]: "Activo", [U.sigla]: "SH" });
      expect((await call(USUARIO, "PATCH", { params: { id: sinHoras }, body: body("Sin Horas", "sin.horas@kairos.test", "SH") })).status).toBe(200);
      expect(fake.rows(TABLES.usuarios.id).find((r) => r.id === sinHoras)!.fields[U.rol]).toBe("Cliente");
      expect((await call(USUARIOS, "POST", { body: nuevoCliente() })).status).toBe(201);
    }, 30_000);

    it("verificación posterior: si le cargan una hora mientras se escribe → se deshace (409)", async () => {
      const sinHoras = fake.seed(TABLES.usuarios.id, { [U.nombre]: "Sin Horas", [U.email]: "sin.horas@kairos.test", [U.rol]: "Empleado", [U.estado]: "Activo", [U.sigla]: "SH" });
      const original = fake.client.update.bind(fake.client);
      vi.spyOn(fake.client, "update").mockImplementation(async (tableId, records, ...rest) => {
        const out = await original(tableId, records, ...rest);
        if (tableId === TABLES.usuarios.id) setUser(sinHoras, { [U.horasReverse]: [horaDe(ids.eva)] });
        return out;
      });
      const res = await call(USUARIO, "PATCH", { params: { id: sinHoras }, body: body("Sin Horas", "sin.horas@kairos.test", "SH") });
      expect(res.status).toBe(409);
      expect(res.json.fieldErrors.rol).toBe(USUARIO_MESSAGES.clienteConHoras);
      expect(fake.rows(TABLES.usuarios.id).find((r) => r.id === sinHoras)!.fields[U.rol]).toBe("Empleado");
    });
  });

  it("verificación posterior: si el proyecto pierde el valor hora mientras se escribe → se deshace (409)", async () => {
    // Otro request borra el valor hora de Beta justo después de que se escribe el usuario.
    const original = fake.client.update.bind(fake.client);
    vi.spyOn(fake.client, "update").mockImplementation(async (tableId, records, ...rest) => {
      const out = await original(tableId, records, ...rest);
      if (tableId === TABLES.usuarios.id) fake.rows(P.id).find((r) => r.id === ids.beta)!.fields[P.fields.valorHora] = null;
      return out;
    });
    const res = await call(USUARIO, "PATCH", {
      params: { id: ids.cli },
      body: { nombre: "Carla Editada", email: "carla.cliente@kairos.test", rol: "Cliente", sigla: "", socio: [], proyectosAsignados: [ids.alfa, ids.beta] },
    });
    expect(res.status).toBe(409);
    expect(fake.rows(TABLES.usuarios.id).find((r) => r.id === ids.cli)!.fields[U.nombre]).toBe("Carla Cliente");
  });

  it("activar un Cliente cuyos proyectos ya no cumplen → 409", async () => {
    const u = fake.rows(TABLES.usuarios.id).find((r) => r.id === ids.cli)!;
    u.fields[U.estado] = "Inactivo";
    u.fields[U.proyectosAsignados] = [ids.alfa, ids.gamma];
    const res = await call(ESTADO, "POST", { params: { id: ids.cli }, body: { activo: true } });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe(USUARIO_MESSAGES.clienteSinValorHora);
    expect(u.fields[U.estado]).toBe("Inactivo");
  });
});

// ── B.4 Proyectos ───────────────────────────────────────────────────────────

const PROYECTO = "app/api/admin/maestros/[tabla]/[id]/route.ts";
const proyectoBody = (over: Record<string, unknown> = {}) => ({
  nombreCorto: "Alfa",
  cliente: [ids.cliA],
  unidadNegocio: [],
  monedaValorHora: "ARS",
  valorHora: "1234,57",
  estado: "Activo",
  descripcion: "",
  ...over,
});

describe("B.4 Proyectos asignados a un usuario Cliente", () => {
  beforeEach(() => loginAs(ids.admin));
  const patch = (body: Record<string, unknown>) => call(PROYECTO, "PATCH", { params: { tabla: "proyectos", id: ids.alfa }, body });
  const alfa = () => fake.rows(P.id).find((r) => r.id === ids.alfa)!.fields;

  it("dejarlo sin valor hora o sin moneda → 409 con el mensaje; nada escrito", async () => {
    for (const over of [{ valorHora: "" }, { monedaValorHora: "" }]) {
      const res = await patch(proyectoBody(over));
      expect(res.status).toBe(409);
      expect(res.json.error).toBe(PROYECTO_MESSAGES.clienteSinValorHora);
    }
    expect(alfa()[P.fields.valorHora]).toBe(1234.57);
    expect(writes()).toEqual([]);
  });

  it("cambiar el valor hora o cerrarlo sí se puede", async () => {
    expect((await patch(proyectoBody({ valorHora: "1500" }))).status).toBe(200);
    expect(alfa()[P.fields.valorHora]).toBe(1500);
    expect((await patch(proyectoBody({ valorHora: "1500", estado: "Cerrado" }))).status).toBe(200);
  });

  it("si el único usuario Cliente está Inactivo, se puede dejar sin valor hora", async () => {
    fake.rows(TABLES.usuarios.id).find((r) => r.id === ids.cli)!.fields[U.estado] = "Inactivo";
    expect((await patch(proyectoBody({ valorHora: "" }))).status).toBe(200);
    expect(alfa()[P.fields.valorHora] ?? null).toBeNull();
  });

  it("cambiarle el cliente → 409 (el Cliente vería proyectos de otro cliente)", async () => {
    const res = await patch(proyectoBody({ cliente: [ids.cliB] }));
    expect(res.status).toBe(409);
    expect(res.json.error).toBe(PROYECTO_MESSAGES.clienteCambioCliente);
  });

  it("un proyecto sin usuarios Cliente se puede dejar sin valor hora (como siempre)", async () => {
    const res = await call(PROYECTO, "PATCH", { params: { tabla: "proyectos", id: ids.otro }, body: proyectoBody({ nombreCorto: "Otro", cliente: [ids.cliB], valorHora: "" }) });
    expect(res.status).toBe(200);
  });
});

// ── B.5 Horas ───────────────────────────────────────────────────────────────

describe("B.5 Un usuario Cliente nunca es Colaborador", () => {
  beforeEach(() => loginAs(ids.admin));
  const hora = (over: Record<string, unknown> = {}) => ({ fecha: "2026-11-10", proyecto: ids.alfa, tarea: "x", desde: "09:00", hasta: "10:00", colaborador: ids.cli, facturable: true, ...over });

  it("alta y edición con un Cliente como Colaborador → 400", async () => {
    const alta = await call("app/api/admin/horas/route.ts", "POST", { body: hora() });
    expect(alta.status).toBe(400);
    expect(alta.json.fieldErrors.colaborador).toBe(HORA_ADMIN_MESSAGES.colaboradorCliente);
    const id = fake.rows(HT.id)[0].id;
    const edit = await call("app/api/admin/horas/[id]/route.ts", "PATCH", { params: { id }, body: hora() });
    expect(edit.status).toBe(400);
    expect(edit.json.fieldErrors.colaborador).toBe(HORA_ADMIN_MESSAGES.colaboradorCliente);
    expect(writes()).toEqual([]);
  });

  it("no aparece en el selector ni en los filtros de Horas", async () => {
    const opts = await loadHorasOptions();
    expect(opts.usuarios.map((u) => u.id)).not.toContain(ids.cli);
    expect(opts.usuarios.map((u) => u.id)).toContain(ids.eva);
  });
});

// ── Página no encontrada ────────────────────────────────────────────────────

describe("Página no encontrada (URL desconocida)", () => {
  it.each([
    ["admin", "/dashboard"],
    ["eva", "/mis-horas"],
    ["cli", "/cliente/horas"],
  ])("sesión %s: «No encontramos esta página.» y «Volver al inicio» → %s, sin estilo de error", async (who, home) => {
    await loginAs(ids[who]);
    const html = renderToStaticMarkup(await NotFoundContent());
    expect(html).toContain(NOT_FOUND_TEXT);
    expect(html).toMatch(new RegExp(`<a[^>]*href="${home}"[^>]*>Volver al inicio</a>`));
    expect(html).not.toContain('role="alert"');
    expect(html).not.toMatch(/danger/);
  });

  it("sin sesión: «Volver al inicio» → /login, sin datos", async () => {
    const html = renderToStaticMarkup(await NotFoundContent());
    expect(html).toContain(NOT_FOUND_TEXT);
    expect(html).toMatch(/<a[^>]*href="\/login"[^>]*>Volver al inicio<\/a>/);
    expect(html).not.toContain("@kairos.test");
  });
});
