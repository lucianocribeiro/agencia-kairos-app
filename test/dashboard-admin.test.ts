import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { readFirstSheet } from "@/lib/xlsx/read";
import { createFakeAirtable } from "./fake-airtable";

/**
 * Dashboard del Admin con importes (CC-F4-11) de punta a punta sobre un Airtable falso:
 * los importes del Admin son EXACTAMENTE los de la vista Cliente (mismo cálculo y mismas
 * tablas), los filtros Cliente y Estado valen para toda la pantalla y el Excel es la
 * pantalla. Hoy = 12/11/2026 en Buenos Aires. Datos sintéticos.
 */
const SECRET = "a".repeat(44);
const fake = createFakeAirtable();
const cookieJar = new Map<string, string>();

vi.mock("@/lib/airtable/client", () => ({ getAirtableClient: () => fake.client }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ SESSION_SECRET: SECRET, AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "appxGhn6qLbmWvMke" }) }));

const { SESSION_COOKIE } = await import("@/lib/auth/constants");
const { signSessionToken } = await import("@/lib/auth/token");
const { passwordFingerprint } = await import("@/lib/auth/password-hash");
const { clearUserCache } = await import("@/lib/auth/user-cache");
const { tablasImportes } = await import("@/lib/cliente/vista");
const { CLIENTE_MESSAGES } = await import("@/lib/cliente/types");
const { vistaDashboardAdmin, nombreArchivoDashboard, DASHBOARD_ADMIN_MESSAGES } = await import("@/lib/horas/dashboard-admin");
const { vistaToSheet } = await import("@/lib/reportes/excel");

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ROUTES = import.meta.glob<Record<string, Handler>>("/app/api/{admin/dashboard,cliente/horas}/**/route.ts", { eager: true });
const VISTA = "app/api/admin/dashboard/vista/route.ts";
const EXCEL = "app/api/admin/dashboard/excel/route.ts";
const HORAS_ONLY = "app/api/admin/dashboard/route.ts";
const CLIENTE = "app/api/cliente/horas/route.ts";

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
function seedHora(colaborador: string, proyecto: string | null, fecha: string, desde: string, hasta: string, extra: Record<string, unknown> = {}) {
  return fake.seed(HT.id, {
    [H.fecha]: fecha,
    [H.colaborador]: [colaborador],
    ...(proyecto ? { [H.proyecto]: [proyecto] } : {}),
    [H.tarea]: `QA ${fecha} ${desde}`,
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
  fake.seed(C.id, { [C.fields.nombre]: "QA Sin Proyectos", [C.fields.sigla]: "SP", [C.fields.estado]: "Activo" });
  const proyecto = (codigo: string, cliente: string, extra: Record<string, unknown> = {}) =>
    fake.seed(P.id, { [P.fields.codigo]: codigo, [P.fields.estado]: "Activo", [P.fields.cliente]: [cliente], ...extra });
  const alfa = proyecto("QZ - Alfa", cliA, { [P.fields.valorHora]: 1234.57, [P.fields.monedaValorHora]: "ARS" });
  const beta = proyecto("QZ - Beta", cliA, { [P.fields.valorHora]: 50, [P.fields.monedaValorHora]: "USD" });
  const gamma = proyecto("QZ - Gamma", cliA); // sin valor hora ni moneda
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
  const eva = user("Eva Empleada", "Empleado", { [U.sigla]: "EVQ" });
  const otto = user("Otto Otero", "Empleado", { [U.sigla]: "OOQ" });
  // Cliente con TODOS los proyectos del cliente A (la vista contra la que se compara).
  const cli = user("Carla Cliente", "Cliente", { [U.proyectosAsignados]: [alfa, beta, gamma] });
  fake.seed(TABLES.parametros.id, { [PA.concepto]: "Alícuota IVA (proforma de horas)", [PA.valor]: "21%" });
  ids = { cliA, cliB, alfa, beta, gamma, otro, admin, eva, otto, cli };

  // Noviembre 2026: facturables con estados distintos, no facturables y sin proyecto.
  seedHora(eva, alfa, "2026-11-02", "09:00", "11:20");
  seedHora(otto, alfa, "2026-11-03", "10:00", "10:47", { [H.estadoFacturacion]: "Facturada" });
  seedHora(eva, alfa, "2026-11-10", "14:00", "15:00", { [H.estadoFacturacion]: "Pagada" });
  seedHora(eva, alfa, "2026-11-04", "08:00", "12:00", { [H.facturable]: false }); // 4 h no facturables
  seedHora(otto, beta, "2026-11-05", "09:00", "10:30", { [H.estadoFacturacion]: "Facturada" });
  seedHora(eva, beta, "2026-11-06", "09:00", "09:07");
  seedHora(eva, gamma, "2026-11-07", "09:00", "11:00");
  seedHora(otto, otro, "2026-11-08", "09:00", "12:00");
  seedHora(otto, null, "2026-11-09", "09:00", "10:00"); // sin proyecto
});

async function loginAs(userId: string) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}

async function call(file: string, search: Record<string, string> = {}) {
  const cookie = cookieJar.get(SESSION_COOKIE);
  const url = new URL("http://localhost/api/x");
  for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
  const req = new NextRequest(url, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });
  const res = await ROUTES[`/${file}`].GET(req, { params: Promise.resolve({}) });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return { status: res.status, text, bytes, json: isJson && text ? JSON.parse(text) : null, headers: res.headers };
}

const NOV = { desde: "2026-11-01", hasta: "2026-11-30", agrupacion: "semanal" };

describe("importes del Admin = importes de la vista Cliente (mismo cálculo, mismas tablas)", () => {
  it.each(["", "Pendiente", "Facturada", "Pagada"])("Cliente = A, estado «%s»", async (estado) => {
    await loginAs(ids.cli);
    const cliente = await call(CLIENTE, { ...NOV, ...(estado ? { estado } : {}) });
    await loginAs(ids.admin);
    const admin = await call(VISTA, { ...NOV, cliente: ids.cliA, ...(estado ? { estado } : {}) });
    expect(admin.status).toBe(200);
    expect(cliente.status).toBe(200);
    expect(admin.json.importes).toEqual(cliente.json.importes);
    expect(tablasImportes(admin.json)).toEqual(tablasImportes(cliente.json));
    expect(admin.json.importes.proyectos.map((p: { codigo: string }) => p.codigo)).toEqual(["QZ - Alfa", "QZ - Beta", "QZ - Gamma"]);
  });

  it("también eligiendo proyectos (los mismos en las dos vistas)", async () => {
    await loginAs(ids.cli);
    const cliente = await call(CLIENTE, { ...NOV, proyectos: `${ids.alfa},${ids.beta}` });
    await loginAs(ids.admin);
    const admin = await call(VISTA, { ...NOV, cliente: ids.cliA, proyectos: `${ids.alfa},${ids.beta}` });
    expect(admin.json.importes).toEqual(cliente.json.importes);
  });

  it("per-estado, colaboradores y totales por moneda (nunca se suman monedas)", async () => {
    await loginAs(ids.admin);
    const { json } = await call(VISTA, { ...NOV, cliente: ids.cliA });
    const alfa = json.importes.proyectos[0];
    expect(alfa.estados.map((e: { estado: string; horas: number }) => [e.estado, e.horas])).toEqual([["Pendiente", 2.33], ["Facturada", 0.78], ["Pagada", 1]]);
    expect(alfa.horas).toBe(4.11); // las 4 h no facturables no cuentan
    expect(alfa.colaboradores.map((c: { nombre: string }) => c.nombre)).toEqual(["Eva Empleada", "Otto Otero"]);
    expect(json.importes.totales.map((t: { moneda: string }) => t.moneda)).toEqual(["ARS", "USD"]);
  });
});

describe("filtros Cliente y Estado: toda la pantalla", () => {
  beforeEach(() => loginAs(ids.admin));

  it("Cliente limita el filtro de proyectos, la tabla, el gráfico y los importes; clientes sin proyectos no se ofrecen", async () => {
    const { json } = await call(VISTA, { ...NOV, cliente: ids.cliA });
    expect(json.clientes.map((c: { nombre: string }) => c.nombre)).toEqual(["QA Cliente Uno SA", "QA Otra Empresa"]);
    expect(json.proyectos.map((p: { codigo: string }) => p.codigo)).toEqual(["QZ - Alfa", "QZ - Beta", "QZ - Gamma"]);
    expect(json.rows.map((r: { proyecto: { codigo: string } }) => r.proyecto.codigo)).toEqual(["QZ - Alfa", "QZ - Beta", "QZ - Gamma"]);
    // La tabla de horas sí incluye las no facturables (Alfa: 2,33 + 0,78 + 1 + 4).
    expect(json.rows[0].total).toBe(8.11);
    expect(json.total).toBe(11.73); // 8,11 + 1,5 + 0,12 + 2
    const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b * 100, 0)) / 100;
    expect(sum(json.columnTotals)).toBe(json.total);
  });

  it("Cliente = Todos incluye al cliente B y las horas sin proyecto (en la tabla, no en los importes)", async () => {
    const { json } = await call(VISTA, NOV);
    expect(json.rows.map((r: { proyecto: { codigo: string } | null }) => r.proyecto?.codigo ?? null)).toEqual(["OT - Otro", "QZ - Alfa", "QZ - Beta", "QZ - Gamma", null]);
    expect(json.importes.proyectos.map((p: { codigo: string }) => p.codigo)).toEqual(["OT - Otro", "QZ - Alfa", "QZ - Beta", "QZ - Gamma"]);
    expect(json.total).toBe(15.73); // + Otro 3 + sin proyecto 1
  });

  it("Estado filtra tabla, gráfico, importes y Excel de forma consistente (vacío = Pendiente)", async () => {
    const pend = (await call(VISTA, { ...NOV, cliente: ids.cliA, estado: "Pendiente" })).json;
    // Pendiente: Alfa 2,33 + 4 (no facturable, vacía → Pendiente), Beta 0,12, Gamma 2.
    expect(pend.total).toBe(8.45);
    expect(pend.importes.proyectos.map((p: { horas: number }) => p.horas)).toEqual([2.33, 0.12, 2]);
    const fact = (await call(VISTA, { ...NOV, cliente: ids.cliA, estado: "Facturada" })).json;
    expect(fact.total).toBe(2.28);
    expect(fact.rows.map((r: { proyecto: { codigo: string } }) => r.proyecto.codigo)).toEqual(["QZ - Alfa", "QZ - Beta"]);
    const xl = await call(EXCEL, { ...NOV, cliente: ids.cliA, estado: "Facturada" });
    const rows = readFirstSheet(xl.bytes);
    expect(rows.some((r) => r[0] === "Estado de facturación: Facturada")).toBe(true);
    expect(rows.find((r) => r[0] === "Total" && r.length > 2)!.at(-1)).toBe(fact.total);
  });

  it("validación: cliente inexistente o sin proyectos, proyecto de otro cliente, estado inválido → 400", async () => {
    expect((await call(VISTA, { ...NOV, cliente: "recNOEXISTE000001" })).status).toBe(400);
    expect((await call(VISTA, { ...NOV, cliente: "basura" })).status).toBe(400);
    expect((await call(VISTA, { ...NOV, cliente: ids.cliA, proyectos: ids.otro })).json.error).toBe("Hay proyectos que no existen en el filtro.");
    expect((await call(VISTA, { ...NOV, estado: "Cobrada" })).status).toBe(400);
  });
});

describe("fallbacks", () => {
  beforeEach(() => loginAs(ids.admin));

  it("proyecto sin valor hora ni moneda → «Importe no disponible» y no suma en los totales", async () => {
    const { json } = await call(VISTA, { ...NOV, cliente: ids.cliA });
    const gamma = json.importes.proyectos.find((p: { codigo: string }) => p.codigo === "QZ - Gamma");
    expect(gamma).toMatchObject({ neto: null, iva: null, total: null, horas: 2 });
    const fila = tablasImportes(json)[0].filas.find((f) => f.cells[0] === "QZ - Gamma")!;
    expect(fila.cells).toEqual(["QZ - Gamma", null, null, 2, CLIENTE_MESSAGES.noDisponible, null, null]);
  });

  it("alícuota inválida → horas sí, importes con el aviso neutro", async () => {
    fake.rows(TABLES.parametros.id)[0].fields[PA.valor] = "mucho";
    const { json, status } = await call(VISTA, { ...NOV, cliente: ids.cliA });
    expect(status).toBe(200);
    expect(json.total).toBeGreaterThan(0);
    expect(json.importes).toBeNull();
    expect(tablasImportes(json)).toEqual([{ titulo: "Importes", columnas: [], filas: [], error: CLIENTE_MESSAGES.importe }]);
  });
});

describe("Excel = pantalla", () => {
  beforeEach(() => loginAs(ids.admin));
  const trim = (r: readonly unknown[]) => {
    const o = [...r];
    while (o.length && (o[o.length - 1] === null || o[o.length - 1] === undefined)) o.pop();
    return o;
  };

  it.each([
    ["cliente A", { cliente: "A" }, "Dashboard_QZ_2026-11-01_2026-11-30.xlsx"],
    ["todos", {}, "Dashboard_Todos_2026-11-01_2026-11-30.xlsx"],
  ])("%s: celda por celda igual a la vista de la pantalla; nombre del archivo", async (_l, over, filename) => {
    const search = { ...NOV, ...("cliente" in over ? { cliente: ids.cliA } : {}) };
    const screen = (await call(VISTA, search)).json;
    const xl = await call(EXCEL, search);
    expect(xl.status).toBe(200);
    expect(xl.headers.get("content-disposition")).toBe(`attachment; filename="${filename}"`);
    expect(nombreArchivoDashboard(screen)).toBe(filename);
    const expected = vistaToSheet(vistaDashboardAdmin(screen), "Dashboard").rows.map((r) => trim(r.map((c) => (c && typeof c === "object" && "v" in c ? c.v : c))));
    const got = readFirstSheet(xl.bytes).map(trim);
    while (got.length && got[got.length - 1].length === 0) got.pop();
    while (expected.length && expected[expected.length - 1].length === 0) expected.pop();
    expect(got).toEqual(expected);
    expect(got.some((r) => r[0] === `Importes: ${DASHBOARD_ADMIN_MESSAGES.soloFacturables.toLowerCase()}`)).toBe(true);
    expect(got.some((r) => r[0] === "Importes por proyecto")).toBe(true);
    expect(got.some((r) => r[0] === "Totales por moneda")).toBe(true);
  });
});

describe("acceso y compatibilidad", () => {
  it("Empleado y Cliente → 403 en las rutas nuevas, sin leer Horas", async () => {
    for (const who of [ids.eva, ids.cli]) {
      await loginAs(who);
      fake.calls.length = 0;
      expect((await call(VISTA, NOV)).status).toBe(403);
      expect((await call(EXCEL, NOV)).status).toBe(403);
      expect(fake.calls.filter((c) => c.tableId === HT.id)).toEqual([]);
    }
    cookieJar.clear();
    expect((await call(VISTA, NOV)).status).toBe(401);
  });

  it("/api/admin/dashboard (solo horas) sigue igual: sin importes, mismas horas que la vista sin filtros", async () => {
    await loginAs(ids.admin);
    const old = await call(HORAS_ONLY, NOV);
    const nueva = (await call(VISTA, NOV)).json;
    expect(old.text).not.toMatch(/importe|valorHora|moneda/);
    expect(old.json.total).toBe(nueva.total);
    expect(old.json.rows).toEqual(nueva.rows);
    expect(old.json.columnTotals).toEqual(nueva.columnTotals);
  });
});
