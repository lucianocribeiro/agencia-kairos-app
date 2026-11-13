import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { cuitSintetico } from "./arca-fixture";
import { createFakeAirtable } from "./fake-airtable";

/** Listas, edición y borrado de comprobantes (rutas + servicio + Airtable falso). Datos sintéticos. */
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
const listRoute = await import("@/app/api/admin/comprobantes/[tabla]/route");
const itemRoute = await import("@/app/api/admin/comprobantes/[tabla]/[id]/route");
const maestroItem = await import("@/app/api/admin/maestros/[tabla]/[id]/route");
const { MENSAJES } = await import("@/lib/ventas-compras/rules");
const { COMPUTED_FIELDS } = await import("@/lib/airtable/schema");

const T = TABLES;
const V = T.ventas.fields;
const C = T.compras.fields;
const U = T.usuarios.fields;
const CUIT_A = cuitSintetico("30", 81000001);
const CUIT_B = cuitSintetico("30", 82000001);
const CUIT_PROV = cuitSintetico("30", 83000001);

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("clave-de-prueba", 4);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-13T15:00:00Z") });
});
afterAll(() => vi.useRealTimers());

let ids: Record<string, string>;
beforeEach(() => {
  fake.reset();
  cookieJar.clear();
  clearUserCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const tipo = (codigo: number, signo: number) => fake.seed(T.tiposComprobante.id, { [T.tiposComprobante.fields.codigo]: codigo, [T.tiposComprobante.fields.signo]: signo });
  const cat = (nombre: string, tipo: string, rp = false) =>
    fake.seed(T.categorias.id, { [T.categorias.fields.nombre]: nombre, [T.categorias.fields.tipo]: tipo, [T.categorias.fields.requiereProyecto]: rp });
  const user = (email: string, rol: string) =>
    fake.seed(T.usuarios.id, { [U.nombre]: email, [U.email]: email, [U.rol]: rol, [U.sigla]: email.slice(0, 2).toUpperCase(), [U.estado]: "Activo", [U.debeCambiarPassword]: false, [U.passwordHash]: hash });
  const un = fake.seed(T.unidadesNegocio.id, { [T.unidadesNegocio.fields.nombre]: "Consultoría" });
  const clienteA = fake.seed(T.clientes.id, { [T.clientes.fields.nombre]: "QA Cliente A", [T.clientes.fields.sigla]: "QA", [T.clientes.fields.estado]: "Inactivo", [T.clientes.fields.cuit]: CUIT_A });
  const clienteP = fake.seed(T.clientes.id, { [T.clientes.fields.nombre]: "QA Cliente P", [T.clientes.fields.sigla]: "QP", [T.clientes.fields.estado]: "Activo" });
  const gastos = cat("Gastos varios", "Gasto");
  ids = {
    admin: user("ana@kairos.test", "Admin"),
    empleado: user("eva@kairos.test", "Empleado"),
    factC: tipo(11, 1),
    ncC: tipo(13, -1),
    un,
    clienteA,
    clienteP,
    ingresoRP: cat("Ingresos por servicios", "Ingreso", true),
    ingreso: cat("Otros ingresos", "Ingreso"),
    gastos,
    proyecto: fake.seed(T.proyectos.id, { [T.proyectos.fields.codigo]: "QP - Web", [T.proyectos.fields.estado]: "Activo", [T.proyectos.fields.cliente]: [clienteP], [T.proyectos.fields.unidadNegocio]: [un] }),
    cerrado: fake.seed(T.proyectos.id, { [T.proyectos.fields.codigo]: "QP - Viejo", [T.proyectos.fields.estado]: "Cerrado", [T.proyectos.fields.cliente]: [clienteP] }),
    socio: fake.seed(T.socios.id, { [T.socios.fields.sigla]: "LR", [T.socios.fields.nombre]: "Luciano" }),
    proveedor: fake.seed(T.proveedores.id, { [T.proveedores.fields.nombre]: "QA Proveedor", [T.proveedores.fields.cuit]: CUIT_PROV, [T.proveedores.fields.categoriaPorDefecto]: [gastos] }),
  };
  fake.seed(T.parametros.id, { [T.parametros.fields.concepto]: "Categoría por defecto en Ventas", [T.parametros.fields.valor]: "Ingresos por servicios" });
});

async function loginAs(userId: string) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}

let n = 0;
function venta(over: Record<string, unknown> = {}) {
  n++;
  return fake.seed(T.ventas.id, {
    [V.claveArca]: `11|2|${n}|${CUIT_A}`,
    [V.fecha]: "2026-10-15",
    [V.tipo]: "11 - Factura C",
    [V.tipoComprobante]: [ids.factC],
    [V.puntoVenta]: 2,
    [V.numeroDesde]: n,
    [V.nroDocReceptor]: CUIT_A,
    [V.denominacionReceptor]: "QA Cliente A",
    [V.moneda]: "$",
    [V.impTotal]: 1210,
    [V.totalIva]: 210,
    ...over,
  });
}
function compra(over: Record<string, unknown> = {}) {
  n++;
  return fake.seed(T.compras.id, {
    [C.claveArca]: `11|2|${n}|${CUIT_PROV}`,
    [C.fecha]: "2026-10-15",
    [C.tipo]: "11 - Factura C",
    [C.tipoComprobante]: [ids.factC],
    [C.puntoVenta]: 2,
    [C.numeroDesde]: n,
    [C.nroDocEmisor]: CUIT_PROV,
    [C.denominacionEmisor]: "QA Proveedor",
    [C.moneda]: "$",
    [C.impTotal]: 1210,
    [C.totalIva]: 210,
    [C.proveedor]: [ids.proveedor],
    [C.categoria]: [ids.gastos],
    ...over,
  });
}

const ctxOf = (tabla: string) => ({ params: Promise.resolve({ tabla }) });
const ctxItem = (tabla: string, id: string) => ({ params: Promise.resolve({ tabla, id }) });
function req(method: string, url: string, body?: unknown) {
  const cookie = cookieJar.get(SESSION_COOKIE);
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
  });
}
async function json(res: Response) {
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const list = (tabla: string, q = "") => listRoute.GET(req("GET", `/api/admin/comprobantes/${tabla}${q}`), ctxOf(tabla)).then(json);
const patch = (tabla: string, id: string, body: unknown) => itemRoute.PATCH(req("PATCH", `/x/${id}`, body), ctxItem(tabla, id)).then(json);
const del = (tabla: string, id: string) => itemRoute.DELETE(req("DELETE", `/x/${id}`), ctxItem(tabla, id)).then(json);
type Row = { id: string; control: string; contraparte: { id: string; nombre: string } | null; importes: Record<string, number>; categoria: { id: string } | null; mesDevengado: string };

describe("lista", () => {
  beforeEach(() => loginAs(ids.admin));

  it("por defecto el año actual por Fecha; valores efectivos, Cliente por CUIT (cliente Inactivo) y Control", async () => {
    const a = venta();
    venta({ [V.fecha]: "2025-12-31" }); // año anterior: fuera
    const res = await list("ventas");
    expect(res.status).toBe(200);
    expect(res.json.range).toEqual({ desde: "2026-01-01", hasta: "2026-12-31" });
    expect(res.json.filas.map((r: Row) => r.id)).toEqual([a]);
    expect(res.json.filas[0]).toMatchObject({
      contraparte: { id: ids.clienteA, nombre: "QA Cliente A" },
      mesDevengado: "2026-10-01",
      categoria: { id: ids.ingresoRP },
      control: MENSAJES.faltaProyecto,
      importes: { total: 121000, iva: 21000, neto: 100000 },
    });
    // nunca se piden los campos de fórmula de Airtable
    const fields = fake.calls.filter((c) => c.tableId === T.ventas.id).flatMap((c) => (c.options as { fields: string[] }).fields);
    for (const f of fields) expect(COMPUTED_FIELDS.has(f)).toBe(false);
  });

  it("totales de todo el conjunto filtrado, no solo de la página (60 filas, páginas de 50); NC y USD", async () => {
    for (let i = 0; i < 58; i++) venta();
    venta({ [V.tipoComprobante]: [ids.ncC], [V.tipo]: "13 - Nota de Crédito C", [V.impTotal]: 605.5, [V.totalIva]: 105.5 });
    venta({ [V.moneda]: "DOL", [V.tipoCambio]: 1000.5, [V.impTotal]: 100.01, [V.totalIva]: 17.36, [V.otrosTributos]: 0.5 });
    const p1 = await list("ventas");
    expect(p1.json).toMatchObject({ cantidad: 60, pagina: 1, paginas: 2 });
    expect(p1.json.filas).toHaveLength(50);
    const expected = { total: 58 * 121000 - 60550 + 10006001, iva: 58 * 21000 - 10550 + 1736868, neto: 58 * 100000 - 50000 + 8219108 };
    expect(p1.json.totales).toMatchObject(expected);
    const p2 = await list("ventas", "?pagina=2");
    expect(p2.json.filas).toHaveLength(10);
    expect(p2.json.totales).toMatchObject(expected);
  });

  it("filtros: fechas, mes devengado efectivo, cliente efectivo, proyecto (y sin proyecto), categoría efectiva, Control; los totales siguen al filtro", async () => {
    const ok = venta({ [V.proyecto]: [ids.proyecto] });
    const sinCli = venta({ [V.nroDocReceptor]: CUIT_B, [V.categoria]: [ids.ingreso] });
    const devSep = venta({ [V.mesDevengado]: "2026-09-01", [V.proyecto]: [ids.proyecto] });
    const viejo = venta({ [V.fecha]: "2026-03-10" });
    const idsOf = (r: { json: { filas: Row[] } }) => r.json.filas.map((x) => x.id).sort();
    expect(idsOf(await list("ventas", "?desde=2026-03-01&hasta=2026-03-31"))).toEqual([viejo]);
    expect(idsOf(await list("ventas", "?mesDesde=2026-09&mesHasta=2026-09"))).toEqual([devSep]);
    expect(idsOf(await list("ventas", `?contraparte=${ids.clienteP}`))).toEqual([ok, devSep].sort());
    expect(idsOf(await list("ventas", "?proyecto=sin"))).toEqual([sinCli, viejo].sort());
    expect(idsOf(await list("ventas", `?categoria=${ids.ingreso}`))).toEqual([sinCli]);
    expect(idsOf(await list("ventas", `?categoria=${ids.ingresoRP}`))).toEqual([ok, devSep, viejo].sort()); // la por defecto
    expect(idsOf(await list("ventas", "?control=ok"))).toEqual([ok, devSep].sort());
    expect(idsOf(await list("ventas", "?control=observaciones"))).toEqual([sinCli, viejo].sort());
    expect(idsOf(await list("ventas", "?control=sinCliente"))).toEqual([sinCli]);
    expect((await list("ventas", "?control=sinCliente")).json.totales).toMatchObject({ total: 121000, neto: 100000 });
    for (const bad of ["?desde=2026-13-01&hasta=2026-12-31", "?mesDesde=2026-9", "?contraparte=x", "?proyecto=x", "?control=nada", "?pagina=0", "?desde=2026-02-01&hasta=2026-01-01"]) {
      expect((await list("ventas", bad)).status, bad).toBe(400);
    }
  });

  it("Compras: proveedor, impacto en resultados y a cuenta del socio", async () => {
    compra();
    compra({ [C.socio]: [ids.socio] });
    const res = await list("compras");
    expect(res.json.totales).toMatchObject({ neto: 200000, impacto: -100000, cuentaSocio: 100000 });
    expect(res.json.filas.every((r: Row) => r.contraparte?.id === ids.proveedor && r.control === MENSAJES.ok)).toBe(true);
  });

  it("cargar el CUIT en Clientes arregla la fila sin tocarla", async () => {
    const id = venta({ [V.nroDocReceptor]: CUIT_B, [V.categoria]: [ids.ingreso] });
    expect((await list("ventas")).json.filas[0]).toMatchObject({ contraparte: null, control: MENSAJES.sinCliente });
    fake.rows(T.clientes.id).find((r) => r.id === ids.clienteP)!.fields[T.clientes.fields.cuit] = CUIT_B;
    expect((await list("ventas")).json.filas[0]).toMatchObject({ id, contraparte: { id: ids.clienteP }, control: MENSAJES.ok });
    expect(fake.calls.some((c) => c.method !== "list")).toBe(false);
  });
});

describe("edición", () => {
  beforeEach(() => loginAs(ids.admin));

  it("escribe solo los editables; Ventas recalcula y escribe el link de Cliente (proyecto → CUIT → ninguno)", async () => {
    const id = venta();
    const res = await patch("ventas", id, { proyecto: ids.proyecto, mesDevengado: "2026-09", unidadNegocio: ids.un, categoria: ids.ingreso, observaciones: " nota " });
    expect(res.status).toBe(200);
    const upd = fake.calls.filter((c) => c.method === "update");
    expect(upd).toHaveLength(1);
    expect((upd[0].payload as { fields: Record<string, unknown> }[])[0].fields).toEqual({
      [V.mesDevengado]: "2026-09-01",
      [V.proyecto]: [ids.proyecto],
      [V.unidadNegocio]: [ids.un],
      [V.categoria]: [ids.ingreso],
      [V.observaciones]: "nota",
      [V.cliente]: [ids.clienteP],
    });
    expect(res.json.fila).toMatchObject({ contraparte: { id: ids.clienteP }, control: MENSAJES.ok });

    // Vaciar el proyecto: el Cliente vuelve a salir del CUIT; vaciar categoría → la por defecto.
    const cleared = await patch("ventas", id, { proyecto: "", categoria: "", mesDevengado: "", unidadNegocio: "", observaciones: "" });
    expect(cleared.status).toBe(200);
    const f = fake.rows(T.ventas.id).find((r) => r.id === id)!.fields;
    expect(f[V.cliente]).toEqual([ids.clienteA]);
    expect(f[V.proyecto]).toEqual([]);
    expect(f).not.toHaveProperty(V.mesDevengado);
    expect(cleared.json.fila).toMatchObject({ categoria: { id: ids.ingresoRP }, mesDevengado: "2026-10-01" });

    // Sin match por CUIT y sin proyecto → link vacío
    const sin = venta({ [V.nroDocReceptor]: CUIT_B, [V.cliente]: [ids.clienteA] });
    await patch("ventas", sin, { observaciones: "x" });
    expect(fake.rows(T.ventas.id).find((r) => r.id === sin)!.fields[V.cliente]).toEqual([]);
  });

  it("las claves no editables no llegan a Airtable", async () => {
    const id = compra();
    const res = await patch("compras", id, { impTotal: 1, claveArca: "x", proveedor: ["recXXXXXXXXXXXXXX"], [C.totalPesos]: 5, cliente: "x", socio: ids.socio });
    expect(res.status).toBe(200);
    const fields = (fake.calls.find((c) => c.method === "update")!.payload as { fields: Record<string, unknown> }[])[0].fields;
    expect(Object.keys(fields).sort()).toEqual([C.mesDevengado, C.proyecto, C.unidadNegocio, C.categoria, C.observaciones, C.socio].sort());
    expect(fields[C.socio]).toEqual([ids.socio]);
    expect(fields[C.categoria]).toEqual([ids.gastos]); // lo que estaba
    for (const k of Object.keys(fields)) expect(COMPUTED_FIELDS.has(k)).toBe(false);
    // Ventas no acepta socio (se descarta)
    const v = venta();
    await patch("ventas", v, { socio: ids.socio });
    expect(Object.keys((fake.calls.filter((c) => c.method === "update").at(-1)!.payload as { fields: Record<string, unknown> }[])[0].fields)).not.toContain(C.socio);
  });

  it.each([
    ["ventas", { proyecto: "cerrado" }, /proyecto activo/],
    ["ventas", { proyecto: "recNOEXISTE00000X" }, /proyecto activo/],
    ["ventas", { unidadNegocio: "recNOEXISTE00000X" }, /unidad de negocio/],
    ["ventas", { categoria: "gastos" }, /categoría de ingreso/],
    ["compras", { categoria: "ingreso" }, /categoría de gasto/],
    ["compras", { socio: "recNOEXISTE00000X" }, /socio válido/],
    ["ventas", { mesDevengado: "2026-13" }, /mes devengado/],
    ["ventas", { observaciones: "x".repeat(2001) }, /2000 caracteres/],
    ["ventas", { proyecto: ["recXXXXXXXXXXXXXX"] }, /formato esperado/],
  ])("%s %j → 400 sin escribir", async (tabla, body, message) => {
    const id = tabla === "ventas" ? venta() : compra();
    const resolved = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, typeof v === "string" ? (ids[v] ?? v) : v]));
    const res = await patch(tabla, id, resolved);
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(message);
    expect(fake.calls.some((c) => c.method === "update")).toBe(false);
  });

  it("se puede mantener el proyecto linkeado aunque ya no esté Activo", async () => {
    const id = venta({ [V.proyecto]: [ids.cerrado] });
    expect((await patch("ventas", id, { proyecto: ids.cerrado, observaciones: "sigue" })).status).toBe(200);
    expect((await patch("ventas", venta(), { proyecto: ids.cerrado })).status).toBe(400);
  });

  it("inexistente o ID inválido → 404", async () => {
    expect((await patch("ventas", "recNOEXISTE000000", {})).status).toBe(404);
    expect((await patch("ventas", "nope", {})).status).toBe(404);
    expect((await patch("horas", "recNOEXISTE000000", {})).status).toBe(404);
  });
});

describe("borrado", () => {
  beforeEach(() => loginAs(ids.admin));

  it("borra un comprobante; el proveedor queda; inexistente → 404", async () => {
    const id = compra();
    expect(await del("compras", id)).toEqual({ status: 200, json: { ok: true, id } });
    expect(fake.rows(T.compras.id)).toHaveLength(0);
    expect(fake.rows(T.proveedores.id).map((r) => r.id)).toEqual([ids.proveedor]);
    expect((await del("compras", id)).status).toBe(404);
  });
});

describe("Proveedores (Maestros de Fase 1)", () => {
  beforeEach(() => loginAs(ids.admin));

  it("un proveedor con Compras no se borra (409)", async () => {
    const id = compra();
    fake.rows(T.proveedores.id).find((r) => r.id === ids.proveedor)!.fields[T.proveedores.fields.compras] = [id];
    const res = await maestroItem.DELETE(req("DELETE", "/x"), { params: Promise.resolve({ tabla: "proveedores", id: ids.proveedor }) }).then(json);
    expect(res.status).toBe(409);
    expect(fake.rows(T.proveedores.id)).toHaveLength(1);
  });
});

describe("guard", () => {
  it("sin sesión 401; Empleado 403 en lista, edición y borrado (sin tocar nada)", async () => {
    const id = venta();
    expect((await list("ventas")).status).toBe(401);
    await loginAs(ids.empleado);
    fake.calls.length = 0;
    expect((await list("ventas")).status).toBe(403);
    expect((await list("compras")).status).toBe(403);
    expect((await patch("ventas", id, { observaciones: "x" })).status).toBe(403);
    expect((await del("ventas", id)).status).toBe(403);
    expect(fake.calls.some((c) => c.method !== "list" || c.tableId === T.ventas.id)).toBe(false);
  });
});
