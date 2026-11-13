import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { createFakeAirtable } from "./fake-airtable";

/** Tesorería de punta a punta (rutas + servicio + Airtable falso). Datos sintéticos. */
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
const coll = await import("@/app/api/admin/tesoreria/route");
const item = await import("@/app/api/admin/tesoreria/[id]/route");
const trfColl = await import("@/app/api/admin/tesoreria/transferencias/route");
const trfItem = await import("@/app/api/admin/tesoreria/transferencias/[transferencia]/route");
const { CONTROL } = await import("@/lib/tesoreria/rules");
const { COMPUTED_FIELDS } = await import("@/lib/airtable/schema");

const T = TABLES;
const M = T.tesoreria.fields;
const U = T.usuarios.fields;

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("clave-de-prueba", 4);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-13T15:00:00Z") });
});
afterAll(() => vi.useRealTimers());
afterEach(() => vi.unstubAllEnvs());

let ids: Record<string, string>;
let numero = 0;
beforeEach(() => {
  fake.reset();
  cookieJar.clear();
  clearUserCache();
  numero = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const O = T.tiposOperacion.fields;
  const tipo = (nombre: string, movimiento: string, o: { suma?: boolean; cat?: string; tercero?: boolean; socio?: boolean } = {}) =>
    fake.seed(T.tiposOperacion.id, {
      [O.nombre]: nombre,
      [O.movimiento]: movimiento,
      [O.sumaAResultados]: !!o.suma,
      ...(o.cat ? { [O.categoriaPorDefecto]: [o.cat] } : {}),
      [O.pideClienteProveedor]: !!o.tercero,
      [O.esDeSocio]: !!o.socio,
    });
  const cuenta = (nombre: string, moneda: string, saldo?: number) =>
    fake.seed(T.cuentas.id, { [T.cuentas.fields.nombre]: nombre, [T.cuentas.fields.moneda]: moneda, ...(saldo !== undefined ? { [T.cuentas.fields.saldoInicial]: saldo } : {}) });
  const user = (email: string, rol: string) =>
    fake.seed(T.usuarios.id, { [U.nombre]: email, [U.email]: email, [U.rol]: rol, [U.sigla]: email.slice(0, 2).toUpperCase(), [U.estado]: "Activo", [U.debeCambiarPassword]: false, [U.passwordHash]: hash });
  const bancarios = fake.seed(T.categorias.id, { [T.categorias.fields.nombre]: "Gastos bancarios" });
  ids = {
    admin: user("ana@kairos.test", "Admin"),
    empleado: user("eva@kairos.test", "Empleado"),
    ars1: cuenta("QA Banco A", "ARS", 1000),
    ars2: cuenta("QA Banco B", "ARS"),
    usd: cuenta("QA Banco U$S", "USD"),
    bancarios,
    cobro: tipo("Cobro a cliente", "Cobranza", { tercero: true }),
    pagoProv: tipo("Pago a proveedor", "Pago", { tercero: true }),
    gastos: tipo("Gastos bancarios", "Pago", { suma: true, cat: bancarios }),
    retiro: tipo("Retiro de socio", "Pago", { socio: true }),
    otro: tipo("Otro (no suma a resultados)", "Ambos"),
    transf: tipo("Transferencia entre cuentas propias", "Ambos"),
    cliente: fake.seed(T.clientes.id, { [T.clientes.fields.nombre]: "QA Cliente", [T.clientes.fields.estado]: "Inactivo" }),
    proveedor: fake.seed(T.proveedores.id, { [T.proveedores.fields.nombre]: "QA Proveedor" }),
    socio: fake.seed(T.socios.id, { [T.socios.fields.sigla]: "LR", [T.socios.fields.nombre]: "Luciano" }),
  };
});

async function loginAs(userId: string) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}
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
const list = (q: string) => coll.GET(req("GET", `/api/admin/tesoreria${q}`), {}).then(json);
const crear = (body: Record<string, unknown>) => coll.POST(req("POST", "/x", body), {}).then(json);
const editar = (id: string, body: Record<string, unknown>) => item.PATCH(req("PATCH", "/x", body), { params: Promise.resolve({ id }) }).then(json);
const borrar = (id: string) => item.DELETE(req("DELETE", "/x"), { params: Promise.resolve({ id }) }).then(json);
const crearTrf = (body: Record<string, unknown>) => trfColl.POST(req("POST", "/x", body), {}).then(json);
const editarTrf = (id: string, body: Record<string, unknown>) => trfItem.PATCH(req("PATCH", "/x", body), { params: Promise.resolve({ transferencia: id }) }).then(json);
const borrarTrf = (id: string) => trfItem.DELETE(req("DELETE", "/x"), { params: Promise.resolve({ transferencia: id }) }).then(json);

/** Movimiento sembrado directo (con N° autonumérico simulado). */
function seedMov(over: Record<string, unknown>) {
  numero++;
  return fake.seed(T.tesoreria.id, { [M.numero]: numero, [M.fecha]: "2026-10-15", [M.cuenta]: [ids.ars1], [M.movimiento]: "Pago", [M.importe]: 100, [M.tipoOperacion]: [ids.otro], ...over });
}
const rows = () => fake.rows(T.tesoreria.id);
const base = (over: Record<string, unknown> = {}) => ({ fecha: "2026-10-15", cuenta: ids.ars1, movimiento: "Pago", importe: "100", tipoOperacion: ids.otro, ...over });

describe("movimientos · alta", () => {
  beforeEach(() => loginAs(ids.admin));

  it("guarda los campos escribibles (nunca calculados); TC solo en USD; importe es-AR", async () => {
    const res = await crear(base({ importe: "1.234,56", tipoCambio: "999", descripcion: " QA " }));
    expect(res.status).toBe(201);
    const f = rows()[0].fields;
    expect(f).toMatchObject({ [M.fecha]: "2026-10-15", [M.cuenta]: [ids.ars1], [M.movimiento]: "Pago", [M.importe]: 1234.56, [M.tipoOperacion]: [ids.otro], [M.descripcion]: "QA" });
    expect(f).not.toHaveProperty(M.tipoCambio);
    for (const k of Object.keys(f)) expect(COMPUTED_FIELDS.has(k)).toBe(false);
    const usd = await crear(base({ cuenta: ids.usd, tipoCambio: "1050,25" }));
    expect(rows().find((r) => r.id === usd.json.id)!.fields[M.tipoCambio]).toBe(1050.25);
  });

  it.each([
    ["movimiento equivocado para el tipo", { tipoOperacion: "cobro" }, "Este tipo debería ser Cobranza"],
    ["falta tercero", { tipoOperacion: "pagoProv" }, CONTROL.faltaTercero],
    ["socio en un tipo que no es de socio", { socio: "socio" }, CONTROL.socioSoloEn],
    ["falta socio", { tipoOperacion: "retiro" }, CONTROL.faltaSocio],
    ["USD sin TC", { cuenta: "usd" }, CONTROL.faltaTc],
    ["sin importe", { importe: "" }, CONTROL.faltaImporte],
    ["importe negativo", { importe: "-5" }, CONTROL.faltaImporte],
    ["sin cuenta", { cuenta: "" }, CONTROL.faltaCuenta],
    ["cuenta inexistente", { cuenta: "recNOEXISTE00000X" }, CONTROL.cuentaInexistente],
    ["tipo de transferencia por el formulario de movimientos", { tipoOperacion: "transf" }, /desde «Transferencia»/],
    ["cliente y proveedor", { cliente: "cliente", proveedor: "proveedor" }, /no los dos/],
    ["cliente en un pago", { cliente: "cliente" }, /el tercero es un proveedor/],
    ["importe inválido", { importe: "12abc" }, /no es un número válido/],
    ["ID inválido", { tipoOperacion: "x" }, /formato esperado/],
  ])("%s → 400 y no se escribe nada", async (_n, over, message) => {
    const resolved = Object.fromEntries(Object.entries(over).map(([k, v]) => [k, typeof v === "string" ? (ids[v] ?? v) : v]));
    const res = await crear(base(resolved));
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(message);
    expect(fake.calls.some((c) => c.method === "create")).toBe(false);
  });

  it("cobro a cliente (cliente Inactivo vale) y retiro de socio se guardan", async () => {
    expect((await crear(base({ movimiento: "Cobranza", tipoOperacion: ids.cobro, cliente: ids.cliente }))).status).toBe(201);
    expect((await crear(base({ tipoOperacion: ids.retiro, socio: ids.socio }))).status).toBe(201);
  });
});

describe("movimientos · edición y borrado", () => {
  beforeEach(() => loginAs(ids.admin));

  it("valida el registro completo y escribe solo lo enviado", async () => {
    const id = seedMov({ [M.descripcion]: "vieja" });
    expect((await editar(id, { descripcion: "nueva" })).status).toBe(200);
    const upd = fake.calls.filter((c) => c.method === "update");
    expect((upd[0].payload as { fields: Record<string, unknown> }[])[0].fields).toEqual({ [M.descripcion]: "nueva" });
    // cambiar a un tipo que pide tercero sin mandarlo → bloqueado
    expect((await editar(id, { tipoOperacion: ids.pagoProv })).json.error).toBe(CONTROL.faltaTercero);
    // pasar de USD a ARS borra el TC
    const usd = seedMov({ [M.cuenta]: [ids.usd], [M.tipoCambio]: 1000 });
    await editar(usd, { cuenta: ids.ars2 });
    expect(rows().find((r) => r.id === usd)!.fields).not.toHaveProperty(M.tipoCambio);
  });

  it("borrar; 404; un registro de transferencia no se edita ni se borra por acá (409)", async () => {
    const id = seedMov({});
    expect((await borrar(id)).status).toBe(200);
    expect((await borrar(id)).status).toBe(404);
    const t = seedMov({ [M.transferencia]: "TR-00000000-0000-0000-0000-000000000000" });
    expect((await editar(t, { descripcion: "x" })).status).toBe(409);
    expect((await borrar(t)).status).toBe(409);
    expect(rows().some((r) => r.id === t)).toBe(true);
  });
});

describe("transferencias", () => {
  beforeEach(() => loginAs(ids.admin));
  const trf = (over: Record<string, unknown> = {}) => ({ cuentaOrigen: ids.ars1, cuentaDestino: ids.ars2, importe: "250", fecha: "2026-10-20", descripcion: "QA", ...over });

  it("crea 2 registros (Pago en origen, Cobranza en destino), mismo ID, Suma N; Impacto 0 y neto 0 en $", async () => {
    const res = await crearTrf(trf());
    expect(res.status).toBe(201);
    expect(res.json.transferencia).toMatch(/^TR-[0-9a-f-]{36}$/);
    const par = rows().filter((r) => r.fields[M.transferencia] === res.json.transferencia);
    expect(par).toHaveLength(2);
    const pago = par.find((r) => r.fields[M.movimiento] === "Pago")!.fields;
    const cobranza = par.find((r) => r.fields[M.movimiento] === "Cobranza")!.fields;
    expect(pago).toMatchObject({ [M.cuenta]: [ids.ars1], [M.importe]: 250, [M.tipoOperacion]: [ids.transf], [M.sumaResultados]: "N" });
    expect(cobranza).toMatchObject({ [M.cuenta]: [ids.ars2], [M.importe]: 250, [M.tipoOperacion]: [ids.transf], [M.sumaResultados]: "N" });
    const a = (await list(`?cuenta=${ids.ars1}`)).json;
    const b = (await list(`?cuenta=${ids.ars2}`)).json;
    expect(a.totales.impacto + b.totales.impacto).toBe(0);
    expect(a.totales.pesos + b.totales.pesos).toBe(0);
    expect(a.filas[0]).toMatchObject({ otraCuenta: { id: ids.ars2 }, control: CONTROL.ok });
    // el ID no es adivinable: dos transferencias → IDs distintos
    const otra = await crearTrf(trf());
    expect(otra.json.transferencia).not.toBe(res.json.transferencia);
  });

  it.each([
    ["monedas distintas", { cuentaDestino: "usd" }, "Las cuentas tienen que ser de la misma moneda."],
    ["misma cuenta", { cuentaDestino: "ars1" }, "Elegí dos cuentas distintas."],
    ["importe 0", { importe: "0" }, CONTROL.faltaImporte],
    ["sin fecha", { fecha: "" }, "Ingresá una fecha válida."],
  ])("%s → 400", async (_n, over, message) => {
    const resolved = Object.fromEntries(Object.entries(over).map(([k, v]) => [k, ids[v as string] ?? v]));
    const res = await crearTrf(trf(resolved));
    expect(res).toMatchObject({ status: 400, json: { error: message } });
    expect(rows()).toHaveLength(0);
  });

  it("USD: TC obligatorio, el mismo en los 2 registros", async () => {
    const usd2 = fake.seed(T.cuentas.id, { [T.cuentas.fields.nombre]: "QA U$S 2", [T.cuentas.fields.moneda]: "USD" });
    expect((await crearTrf(trf({ cuentaOrigen: ids.usd, cuentaDestino: usd2 }))).json.error).toBe(CONTROL.faltaTc);
    const ok = await crearTrf(trf({ cuentaOrigen: ids.usd, cuentaDestino: usd2, tipoCambio: "1050,5" }));
    expect(ok.status).toBe(201);
    expect(rows().map((r) => r.fields[M.tipoCambio])).toEqual([1050.5, 1050.5]);
  });

  it("falla inyectada en el 2.º alta → se deshace el 1.º → 503, nada queda", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "transferencia:crear:2");
    const res = await crearTrf(trf());
    expect(res).toEqual({ status: 503, json: { error: "No pudimos completar el cambio. No se modificó nada; probá de nuevo." } });
    expect(fake.calls.filter((c) => c.method === "create")).toHaveLength(1);
    expect(rows()).toHaveLength(0);
  });

  it("verificación posterior: si la relectura no trae el par → se deshace → 503", async () => {
    fake.hide(T.tesoreria.id, () => true);
    const res = await crearTrf(trf());
    expect(res.status).toBe(503);
    expect(rows()).toHaveLength(0);
  });

  it("editar actualiza los 2 registros; falla en el 2.º → se restauran los 2", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    expect((await editarTrf(id, { importe: "300", descripcion: "editada" })).status).toBe(200);
    expect(rows().map((r) => [r.fields[M.importe], r.fields[M.descripcion]])).toEqual([
      [300, "editada"],
      [300, "editada"],
    ]);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "transferencia:editar:2");
    const res = await editarTrf(id, { importe: "999", cuentaDestino: ids.ars1, cuentaOrigen: ids.ars2 });
    expect(res.status).toBe(503);
    const pago = rows().find((r) => r.fields[M.movimiento] === "Pago")!.fields;
    expect(pago).toMatchObject({ [M.importe]: 300, [M.cuenta]: [ids.ars1] });
    expect(rows().map((r) => r.fields[M.importe])).toEqual([300, 300]);
    expect((await editarTrf(id, { cuentaDestino: ids.usd })).json.error).toBe("Las cuentas tienen que ser de la misma moneda.");
  });

  it("borrar el par; si falla el 2.º borrado, el 1.º se vuelve a crear con los mismos valores e ID → 503", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    const before = rows().map((r) => ({ ...r.fields }));
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "transferencia:borrar:2");
    const res = await borrarTrf(id);
    expect(res.status).toBe(503);
    expect(rows()).toHaveLength(2);
    const restored = rows().find((r) => r.fields[M.movimiento] === "Pago")!.fields;
    const sinNumero = Object.fromEntries(Object.entries(before.find((f) => f[M.movimiento] === "Pago")!).filter(([k]) => k !== M.numero));
    expect(restored).toMatchObject(sinNumero);
    vi.unstubAllEnvs();
    expect((await borrarTrf(id)).status).toBe(200);
    expect(rows()).toHaveLength(0);
    expect((await borrarTrf(id)).status).toBe(404);
    expect((await borrarTrf("nope")).status).toBe(404);
  });

  it("si también falla la restauración → 500 «quedó incompleto»", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "transferencia:borrar:2");
    fake.failWhen((call) => call.method === "create" && call.tableId === T.tesoreria.id, new Error("caída"));
    expect((await borrarTrf(id)).status).toBe(500);
  });
});

describe("lista y saldo", () => {
  beforeEach(() => loginAs(ids.admin));

  it("Saldo = saldo inicial + Σ con signo (Fecha, N°); con filtro de Fecha la 1.ª fila incluye lo anterior", async () => {
    seedMov({ [M.fecha]: "2026-09-10", [M.movimiento]: "Cobranza", [M.importe]: 500 }); // 1000 + 500 = 1500
    seedMov({ [M.fecha]: "2026-10-05", [M.importe]: 200 }); // 1300
    seedMov({ [M.fecha]: "2026-10-05", [M.movimiento]: "Cobranza", [M.importe]: 50 }); // 1350 (mismo día, N° mayor)
    seedMov({ [M.fecha]: "2026-11-01", [M.importe]: 25.5, [M.tipoOperacion]: [ids.gastos] }); // 1324.50
    seedMov({ [M.fecha]: "2026-10-06", [M.cuenta]: [ids.ars2], [M.importe]: 999 }); // otra cuenta
    const all = (await list(`?cuenta=${ids.ars1}`)).json;
    expect(all.filas.map((f: { saldo: number }) => f.saldo)).toEqual([150000, 130000, 135000, 132450]);
    expect(all).toMatchObject({ saldoActual: 132450, saldoInicioPeriodo: 100000, saldoFinPeriodo: 132450 });
    expect(all.totales).toEqual({ entradas: 55000, salidas: 22550, neto: 32450, pesos: 32450, impacto: -2550, cuentaSocio: 0 });
    const oct = (await list(`?cuenta=${ids.ars1}&desde=2026-10-01&hasta=2026-10-31`)).json;
    expect(oct.filas.map((f: { saldo: number }) => f.saldo)).toEqual([130000, 135000]);
    expect(oct).toMatchObject({ saldoInicioPeriodo: 150000, saldoFinPeriodo: 135000, saldoActual: 132450 });
    expect(oct.totales).toMatchObject({ entradas: 5000, salidas: 20000, neto: -15000 });
    // saldo inicial vacío = 0
    expect((await list(`?cuenta=${ids.ars2}`)).json).toMatchObject({ saldoActual: -99900 });
  });

  it("filtros de tipo, movimiento y Control no cambian el saldo corrido de cada fila; totales siguen al filtro", async () => {
    seedMov({ [M.movimiento]: "Cobranza", [M.importe]: 500, [M.fecha]: "2026-10-01" });
    seedMov({ [M.importe]: 25, [M.tipoOperacion]: [ids.gastos], [M.fecha]: "2026-10-02" });
    seedMov({ [M.importe]: 10, [M.tipoOperacion]: [ids.pagoProv], [M.fecha]: "2026-10-03" }); // falta tercero
    const gastos = (await list(`?cuenta=${ids.ars1}&tipo=${ids.gastos}`)).json;
    expect(gastos.filas).toHaveLength(1);
    expect(gastos.filas[0].saldo).toBe(147500);
    expect(gastos.totales).toMatchObject({ salidas: 2500, impacto: -2500 });
    expect((await list(`?cuenta=${ids.ars1}&movimiento=Cobranza`)).json.filas).toHaveLength(1);
    const obs = (await list(`?cuenta=${ids.ars1}&control=faltaTercero`)).json;
    expect(obs.filas.map((f: { control: string; saldo: number }) => [f.control, f.saldo])).toEqual([[CONTROL.faltaTercero, 146500]]);
    expect((await list(`?cuenta=${ids.ars1}&control=ok`)).json.filas).toHaveLength(2);
  });

  it("USD: Importe $ con el TC del registro; sin TC → Control «Falta tipo de cambio» y Importe $ vacío", async () => {
    seedMov({ [M.cuenta]: [ids.usd], [M.movimiento]: "Cobranza", [M.importe]: 100.01, [M.tipoCambio]: 1.5 });
    seedMov({ [M.cuenta]: [ids.usd], [M.importe]: 10 });
    const res = (await list(`?cuenta=${ids.usd}`)).json;
    expect(res.filas.map((f: { importePesos: number | null; control: string }) => [f.importePesos, f.control])).toEqual([
      [15002, CONTROL.ok],
      [null, CONTROL.faltaTc],
    ]);
    expect(res.saldoActual).toBe(9001);
  });

  it("cuenta obligatoria; filtros inválidos → 400; nunca se piden campos calculados", async () => {
    expect((await list("")).status).toBe(400);
    expect((await list("?cuenta=x")).status).toBe(400);
    for (const bad of ["&movimiento=Otro", "&control=nada", "&tipo=x", "&pagina=0", "&desde=2026-02-01&hasta=2026-01-01"]) expect((await list(`?cuenta=${ids.ars1}${bad}`)).status, bad).toBe(400);
    await list(`?cuenta=${ids.ars1}`);
    const fields = fake.calls.filter((c) => c.tableId === T.tesoreria.id).flatMap((c) => (c.options as { fields: string[] }).fields);
    expect(fields.some((f) => COMPUTED_FIELDS.has(f) && f !== M.numero)).toBe(false);
  });

  it("límite: 5.000 movimientos en el rango → 200; 5.001 → 400", async () => {
    const seedMany = (n: number) => {
      for (let i = 0; i < n; i++) rows().push({ id: `recTES${String(i).padStart(11, "0")}`, createdTime: "", fields: { [M.numero]: i, [M.fecha]: "2026-10-15", [M.cuenta]: [ids.ars1], [M.movimiento]: "Pago", [M.importe]: 1, [M.tipoOperacion]: [ids.otro] } });
    };
    seedMany(5000);
    expect((await list(`?cuenta=${ids.ars1}`)).json.cantidad).toBe(5000);
    seedMany(1);
    expect(await list(`?cuenta=${ids.ars1}`)).toEqual({ status: 400, json: { error: "El período tiene más de 5.000 movimientos. Elegí un rango de fechas más corto." } });
  });
});

describe("guard", () => {
  it("sin sesión 401; Empleado 403 en todas las rutas nuevas, sin tocar nada", async () => {
    const id = seedMov({});
    expect((await list(`?cuenta=${ids.ars1}`)).status).toBe(401);
    await loginAs(ids.empleado);
    fake.calls.length = 0;
    const statuses = [
      (await list(`?cuenta=${ids.ars1}`)).status,
      (await crear(base())).status,
      (await editar(id, { descripcion: "x" })).status,
      (await borrar(id)).status,
      (await crearTrf({})).status,
      (await editarTrf("TR-00000000-0000-0000-0000-000000000000", {})).status,
      (await borrarTrf("TR-00000000-0000-0000-0000-000000000000")).status,
    ];
    expect(statuses).toEqual([403, 403, 403, 403, 403, 403, 403]);
    expect(fake.calls.some((c) => c.method !== "list" || c.tableId === T.tesoreria.id)).toBe(false);
  });
});
