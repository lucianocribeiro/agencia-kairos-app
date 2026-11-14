import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { readFirstSheet } from "@/lib/xlsx/read";
import { createFakeAirtable } from "./fake-airtable";

/** Reportes de punta a punta (rutas + servicio + Airtable falso). Datos sintéticos. */
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
const jsonRoute = await import("@/app/api/admin/reportes/[reporte]/route");
const excelRoute = await import("@/app/api/admin/reportes/[reporte]/excel/route");
const { valorExcel } = await import("@/lib/reportes/excel");
const { kindDe } = await import("@/lib/reportes/vista");
const { COMPROBANTE_FIELDS, MOVIMIENTO_FIELDS, HORA_FIELDS } = await import("@/lib/reportes/server/load");

type Vista = import("@/lib/reportes/vista").Vista;
const T = TABLES;
const U = T.usuarios.fields;
const SLUGS = ["resultados", "resultados-por-proyecto", "socios", "saldos"] as const;

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("clave-de-prueba", 4);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-14T15:00:00Z") });
});
afterAll(() => vi.useRealTimers());

let ids: Record<string, string>;
beforeEach(() => {
  fake.reset();
  cookieJar.clear();
  clearUserCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const user = (email: string, rol: string) =>
    fake.seed(T.usuarios.id, { [U.nombre]: email, [U.email]: email, [U.rol]: rol, [U.sigla]: email.slice(0, 2).toUpperCase(), [U.estado]: "Activo", [U.debeCambiarPassword]: false, [U.passwordHash]: hash });
  const C = T.categorias.fields;
  const O = T.tiposOperacion.fields;
  const tipo = (nombre: string, movimiento: string, o: { suma?: boolean; cat?: string; socio?: boolean; tercero?: boolean } = {}) =>
    fake.seed(T.tiposOperacion.id, { [O.nombre]: nombre, [O.movimiento]: movimiento, [O.sumaAResultados]: !!o.suma, ...(o.cat ? { [O.categoriaPorDefecto]: [o.cat] } : {}), [O.esDeSocio]: !!o.socio, [O.pideClienteProveedor]: !!o.tercero });
  fake.seed(T.categorias.id, { [C.nombre]: "Ingresos por servicios", [C.tipo]: "Ingreso" });
  const gas = fake.seed(T.categorias.id, { [C.nombre]: "Gastos varios", [C.tipo]: "Gasto" });
  const un = fake.seed(T.unidadesNegocio.id, { [T.unidadesNegocio.fields.nombre]: "Consultoría" });
  const cliente = fake.seed(T.clientes.id, { [T.clientes.fields.nombre]: "QA Cliente", [T.clientes.fields.sigla]: "QA", [T.clientes.fields.estado]: "Activo" });
  const proyecto = fake.seed(T.proyectos.id, { [T.proyectos.fields.codigo]: "QA - Web", [T.proyectos.fields.estado]: "Activo", [T.proyectos.fields.cliente]: [cliente], [T.proyectos.fields.unidadNegocio]: [un] });
  const proveedor = fake.seed(T.proveedores.id, { [T.proveedores.fields.nombre]: "QA Proveedor", [T.proveedores.fields.categoriaPorDefecto]: [gas] });
  const lr = fake.seed(T.socios.id, { [T.socios.fields.sigla]: "LR", [T.socios.fields.nombre]: "Luciano", [T.socios.fields.porcentajeRetiros]: 0.5 });
  fake.seed(T.socios.id, { [T.socios.fields.sigla]: "SK", [T.socios.fields.nombre]: "Socia", [T.socios.fields.porcentajeRetiros]: 0.5 });
  const P = T.parametros.fields;
  fake.seed(T.parametros.id, { [P.concepto]: "Categoría por defecto en Ventas", [P.valor]: "Ingresos por servicios" });
  fake.seed(T.parametros.id, { [P.concepto]: "Primer mes de los reportes", [P.valor]: "2026-01-01" });
  const fac = fake.seed(T.tiposComprobante.id, { [T.tiposComprobante.fields.codigo]: 11, [T.tiposComprobante.fields.signo]: 1 });
  const banco = fake.seed(T.cuentas.id, { [T.cuentas.fields.nombre]: "Banco $", [T.cuentas.fields.moneda]: "ARS", [T.cuentas.fields.saldoInicial]: 1000 });
  const cobro = tipo("Cobro a cliente", "Cobranza", { tercero: true });
  tipo("Pago a proveedor", "Pago", { tercero: true });
  tipo("Gastos bancarios", "Pago", { suma: true, cat: gas });
  const retiro = tipo("Retiro de socio", "Pago", { socio: true });
  tipo("Gasto particular de socio", "Pago", { socio: true });
  tipo("Aporte de socio", "Cobranza", { socio: true });
  const V = T.ventas.fields;
  fake.seed(T.ventas.id, { [V.claveArca]: "11|2|1|x", [V.fecha]: "2026-03-10", [V.tipoComprobante]: [fac], [V.impTotal]: 1210, [V.totalIva]: 210, [V.proyecto]: [proyecto] });
  const CF = T.compras.fields;
  fake.seed(T.compras.id, { [CF.claveArca]: "11|2|1|y", [CF.fecha]: "2026-03-15", [CF.tipoComprobante]: [fac], [CF.impTotal]: 500, [CF.proveedor]: [proveedor] });
  const M = T.tesoreria.fields;
  fake.seed(T.tesoreria.id, { [M.fecha]: "2026-03-20", [M.cuenta]: [banco], [M.movimiento]: "Cobranza", [M.importe]: 1000, [M.tipoOperacion]: [cobro], [M.cliente]: [cliente] });
  fake.seed(T.tesoreria.id, { [M.fecha]: "2026-04-01", [M.cuenta]: [banco], [M.movimiento]: "Pago", [M.importe]: 300, [M.tipoOperacion]: [retiro], [M.socio]: [lr] });
  const H = T.horas.fields;
  fake.seed(T.horas.id, { [H.fecha]: "2026-03-02", [H.proyecto]: [proyecto], [H.horaDesde]: 9 * 3600, [H.horaHasta]: 11 * 3600 });
  ids = { admin: user("ana@kairos.test", "Admin"), empleado: user("eva@kairos.test", "Empleado"), retiro };
});

async function loginAs(userId: string) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}
function req(url: string) {
  const cookie = cookieJar.get(SESSION_COOKIE);
  return new NextRequest(`http://localhost${url}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });
}
const ctx = (reporte: string) => ({ params: Promise.resolve({ reporte }) });
async function getJson(reporte: string, q = "") {
  const res = await jsonRoute.GET(req(`/api/admin/reportes/${reporte}${q}`), ctx(reporte));
  return { status: res.status, json: await res.json() };
}
async function getExcel(reporte: string, q = "") {
  const res = await excelRoute.GET(req(`/api/admin/reportes/${reporte}/excel${q}`), ctx(reporte));
  return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** Cada fila de cada tabla de la vista aparece en el .xlsx, en orden, con los mismos valores. */
function expectSheetMatchesVista(rows: (string | number | boolean | null)[][], vista: Vista) {
  const trim = (r: unknown[]) => {
    const out = [...r];
    while (out.length && (out[out.length - 1] === null || out[out.length - 1] === undefined)) out.pop();
    return out;
  };
  expect(rows[0]).toEqual([vista.titulo]);
  expect(rows[1]).toEqual([vista.lineas[0]]);
  let cursor = 2;
  const next = (expected: unknown[]) => {
    const i = rows.findIndex((r, k) => k >= cursor && JSON.stringify(trim(r)) === JSON.stringify(trim(expected)));
    expect(i, `fila ${JSON.stringify(expected)}`).toBeGreaterThanOrEqual(cursor);
    cursor = i + 1;
  };
  for (const t of vista.tablas) {
    next(t.columnas.map((c) => c.label));
    for (const f of t.filas) {
      const expected = t.columnas.map((c, i) => valorExcel(kindDe(c, f), f.cells[i] ?? null));
      next(expected);
      // los importes y porcentajes son números (nunca texto)
      const row = rows[cursor - 1];
      t.columnas.forEach((c, i) => {
        if (typeof f.cells[i] === "number") expect(typeof row[i], `${c.label}`).toBe("number");
      });
    }
  }
}

describe("reportes · Admin", () => {
  beforeEach(() => loginAs(ids.admin));

  it("Resultados: período por defecto del Parámetro y valores (centavos)", async () => {
    const { status, json } = await getJson("resultados");
    expect(status).toBe(200);
    expect(json.data.periodo.label).toBe("Período: 01/2026 a 12/2026");
    expect(json.data.aviso).toBeNull();
    expect(json.data.ingresos[0]).toMatchObject({ nombre: "Ingresos por servicios", total: 100000 });
    expect(json.data.ingresos[0].valores[2]).toBe(100000);
    expect(json.data.gastos[0]).toMatchObject({ nombre: "Gastos varios", total: 50000 });
    expect(json.data.resultado.total).toBe(50000);
    expect(json.data.margen[12]).toBe(0.5);
  });

  it("Por UN y proyecto, Socios y Saldos", async () => {
    const p = (await getJson("resultados-por-proyecto")).json.data;
    expect(p.unidades[0]).toMatchObject({ nombre: "Consultoría", ingresos: 100000, gastos: 0 });
    expect(p.sinUnidad).toMatchObject({ ingresos: 0, gastos: 50000 });
    expect(p.proyectos[0]).toMatchObject({ nombre: "QA - Web", horas: 2, ingresoPorHora: 50000, cliente: "QA Cliente", unidadNegocio: "Consultoría" });
    const s = (await getJson("socios")).json.data;
    expect(s.socios[0]).toMatchObject({ sigla: "LR", retiros: 30000, totalNeto: 30000, leCorresponde: 15000, diferencia: 15000, situacion: "Retiró $ 150 de más" });
    expect(s.porMes[0].valores[3]).toBe(30000);
    const d = (await getJson("saldos")).json.data;
    expect(d.cuentas[0]).toMatchObject({ nombre: "Banco $", saldoInicial: 100000, entradas: 100000, salidas: 30000, saldoActual: 170000 });
    expect(d.clientes[0]).toMatchObject({ nombre: "QA Cliente", facturado: 121000, cobrado: 100000, saldo: 21000 });
    expect(d.proveedores[0]).toMatchObject({ nombre: "QA Proveedor", facturado: 50000, pagado: 0, saldo: 50000 });
  });

  it("solo pide los campos que usa (schema.ts)", async () => {
    await getJson("resultados");
    const fieldsOf = (tableId: string) => fake.calls.filter((c) => c.method === "list" && c.tableId === tableId).map((c) => (c.options as { fields: string[] }).fields);
    expect(fieldsOf(T.ventas.id)).toEqual([COMPROBANTE_FIELDS.ventas]);
    expect(fieldsOf(T.compras.id)).toEqual([COMPROBANTE_FIELDS.compras]);
    expect(fieldsOf(T.tesoreria.id)).toEqual([MOVIMIENTO_FIELDS]);
    expect(fieldsOf(T.horas.id)).toEqual([]);
    await getJson("resultados-por-proyecto");
    expect(fieldsOf(T.horas.id)).toEqual([HORA_FIELDS]);
  });

  it.each(SLUGS)("%s: el .xlsx tiene los mismos valores que la pantalla, números como números", async (slug) => {
    const { json } = await getJson(slug);
    const xl = await getExcel(slug);
    expect(xl.status).toBe(200);
    expect(xl.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const archivo = { resultados: "Resultados_202601", "resultados-por-proyecto": "Resultados_por_proyecto_202601", socios: "Socios_202601", saldos: "Saldos_202611" }[slug];
    expect(xl.headers.get("content-disposition")).toBe(`attachment; filename="${archivo}.xlsx"`);
    expectSheetMatchesVista(readFirstSheet(xl.bytes), json.vista);
  });

  it("cambiar el mes inicial: el período y las columnas se corren (pantalla y .xlsx)", async () => {
    const { json } = await getJson("resultados", "?desde=2026-03");
    expect(json.data.periodo.label).toBe("Período: 03/2026 a 02/2027");
    expect(json.data.ingresos[0].valores[0]).toBe(100000);
    expect(json.vista.tablas[0].columnas[1].label).toBe("03/2026");
    const xl = await getExcel("resultados", "?desde=2026-03");
    expect(xl.headers.get("content-disposition")).toContain("Resultados_202603.xlsx");
    const rows = readFirstSheet(xl.bytes);
    expect(rows[1]).toEqual(["Período: 03/2026 a 02/2027"]);
    expectSheetMatchesVista(rows, json.vista);
  });

  it("mes inválido → 400; reporte desconocido → 404; parámetro inválido → enero del año actual con aviso", async () => {
    expect((await getJson("resultados", "?desde=2026-13")).status).toBe(400);
    expect((await getExcel("socios", "?desde=marzo")).status).toBe(400);
    expect((await getJson("otro")).status).toBe(404);
    expect((await getExcel("otro")).status).toBe(404);
    const param = fake.rows(T.parametros.id).find((r) => r.fields[T.parametros.fields.concepto] === "Primer mes de los reportes")!;
    param.fields[T.parametros.fields.valor] = "01/2026";
    const { json } = await getJson("resultados");
    expect(json.data.periodo.desde).toBe("2026-01");
    expect(json.data.aviso).toBe("Revisá el parámetro Primer mes de los reportes en Maestros.");
    expect(json.vista.avisos).toEqual(["Revisá el parámetro Primer mes de los reportes en Maestros."]);
  });

  it("Socios: si falta un tipo de operación, la pantalla y el .xlsx muestran el error con el nombre", async () => {
    fake.rows(T.tiposOperacion.id).splice(
      fake.rows(T.tiposOperacion.id).findIndex((r) => r.id === ids.retiro),
      1,
    );
    const { status, json } = await getJson("socios");
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ ok: false, faltan: ["Retiro de socio"] });
    expect(json.vista.error).toContain("«Retiro de socio»");
    expect(json.vista.tablas).toEqual([]);
    const rows = readFirstSheet((await getExcel("socios")).bytes);
    expect(rows.flat()).toContain(json.vista.error);
  });
});

describe("reportes · Empleado", () => {
  beforeEach(() => loginAs(ids.empleado));

  it.each(SLUGS)("%s: 403 en la API y en la descarga, sin leer Ventas, Compras ni Tesorería", async (slug) => {
    fake.calls.length = 0;
    expect((await getJson(slug)).status).toBe(403);
    expect((await getExcel(slug)).status).toBe(403);
    expect(fake.calls.filter((c) => c.tableId !== T.usuarios.id)).toEqual([]);
  });
});

describe("reportes · sin sesión", () => {
  it("401", async () => {
    expect((await getJson("resultados")).status).toBe(401);
    expect((await getExcel("saldos")).status).toBe(401);
  });
});
