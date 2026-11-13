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

  /** Registros con ese ID de transferencia. */
  const conId = (id: string) => rows().filter((r) => r.fields[M.transferencia] === id);
  /** ¿El par está completo y con los valores esperados? (para afirmar que nunca hay 2xx con el par roto) */
  const parOk = (id: string, importe: number) => {
    const par = conId(id);
    return par.length === 2 && par.every((r) => r.fields[M.importe] === importe) && par.some((r) => r.fields[M.movimiento] === "Pago") && par.some((r) => r.fields[M.movimiento] === "Cobranza");
  };
  const fault = (point: string) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KAIROS_FAULT_INJECTION", point);
  };
  /** Ejecuta `fn` la `n`-ésima vez que se lista Tesorería (0 = la primera). */
  const onList = (n: number, fn: () => void) => {
    let i = 0;
    fake.failWhen((call) => {
      if (call.method === "list" && call.tableId === T.tesoreria.id && i++ === n) fn();
      return false;
    });
  };

  it("alta: los 2 registros en UN solo pedido de create", async () => {
    await crearTrf(trf());
    const creates = fake.calls.filter((c) => c.method === "create" && c.tableId === T.tesoreria.id);
    expect(creates).toHaveLength(1);
    expect(creates[0].payload as unknown[]).toHaveLength(2);
  });

  it("alta aplicada pero respondida con error → se borra todo lo que tiene el ID → 503, 0 registros", async () => {
    fault("transferencia:crear:respuesta");
    const res = await crearTrf(trf());
    expect(res).toEqual({ status: 503, json: { error: "No pudimos completar el cambio. No se modificó nada; probá de nuevo." } });
    expect(rows()).toHaveLength(0);
  });

  it("alta: la verificación encuentra valores distintos (otro importe) → limpieza → 503, 0 registros", async () => {
    onList(0, () => {
      // la relectura de la verificación ve un registro alterado
      rows()[0].fields[M.importe] = 999;
    });
    const res = await crearTrf(trf());
    expect(res.status).toBe(503);
    expect(rows()).toHaveLength(0);
  });

  it("alta: la verificación encuentra solo 1 de los 2 → limpieza → 503, 0 registros", async () => {
    onList(0, () => rows().splice(1, 1));
    expect((await crearTrf(trf())).status).toBe(503);
    expect(rows()).toHaveLength(0);
  });

  it("alta: si la limpieza no puede borrar → 500 «quedó incompleto» (y nunca 2xx)", async () => {
    fault("transferencia:crear:respuesta");
    fake.failWhen((call) => call.method === "delete", new Error("caída"));
    const res = await crearTrf(trf());
    expect(res).toEqual({ status: 500, json: { error: "El cambio quedó incompleto. Avisá a un administrador." } });
    expect(rows()).toHaveLength(2); // quedan; el log lleva los IDs
  });

  it("alta: si la relectura de la limpieza falla → 500", async () => {
    fault("transferencia:crear:respuesta");
    fake.failWhen((call) => call.method === "list" && call.tableId === T.tesoreria.id, new Error("caída"));
    expect((await crearTrf(trf())).status).toBe(500);
  });

  it("edición: actualiza los 2 en UN pedido y verifica todos los campos", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    fake.calls.length = 0;
    expect((await editarTrf(id, { importe: "300", descripcion: "editada" })).status).toBe(200);
    const updates = fake.calls.filter((c) => c.method === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload as unknown[]).toHaveLength(2);
    expect(conId(id).map((r) => [r.fields[M.importe], r.fields[M.descripcion]])).toEqual([
      [300, "editada"],
      [300, "editada"],
    ]);
  });

  it("edición: cambio concurrente antes de escribir → 409, nada escrito", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    fake.calls.length = 0;
    onList(1, () => {
      rows()[1].fields[M.descripcion] = "otro request";
    });
    const res = await editarTrf(id, { importe: "300" });
    expect(res).toEqual({ status: 409, json: { error: "La transferencia cambió mientras la editabas. Recargá y probá de nuevo." } });
    expect(fake.calls.some((c) => c.method === "update")).toBe(false);
    expect(conId(id).map((r) => r.fields[M.importe])).toEqual([250, 250]);
  });

  /** Valores actuales de las 2 patas (por movimiento). */
  const patas = (id: string) => {
    const par = conId(id);
    const f = (mov: string) => par.find((r) => r.fields[M.movimiento] === mov)!;
    return { pago: f("Pago"), cobranza: f("Cobranza") };
  };
  const updates = () => fake.calls.filter((c) => c.method === "update");

  it("edición concurrente que llega DESPUÉS de nuestro update → 409, sin restaurar: quedan los valores de la otra persona", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    fake.calls.length = 0;
    onList(2, () => {
      // otra persona edita la transferencia entera entre nuestro update y la verificación
      for (const r of conId(id)) {
        r.fields[M.importe] = 777;
        r.fields[M.descripcion] = "otra persona";
      }
    });
    const res = await editarTrf(id, { importe: "300" });
    expect(res).toEqual({ status: 409, json: { error: "Otra persona editó esta transferencia al mismo tiempo. Recargá para ver los datos actuales." } });
    expect(updates()).toHaveLength(1); // solo el nuestro: no hubo restauración
    expect(conId(id).map((r) => [r.fields[M.importe], r.fields[M.descripcion]])).toEqual([
      [777, "otra persona"],
      [777, "otra persona"],
    ]);
  });

  it("aplicado a medias (solo una pata) → se restaura solo esa → 503, las 2 originales", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    const { pago } = patas(id);
    fake.calls.length = 0;
    let n = 0;
    fake.failWhen((call) => {
      if (call.method !== "update" || n++ !== 0) return false;
      // Airtable aplica solo el primer registro del pedido y responde con error
      const first = (call.payload as { id: string; fields: Record<string, unknown> }[])[0];
      Object.assign(rows().find((r) => r.id === first.id)!.fields, first.fields);
      return true;
    }, new Error("caída"));
    const res = await editarTrf(id, { importe: "300" });
    expect(res.status).toBe(503);
    expect(updates()).toHaveLength(2);
    expect((updates()[1].payload as { id: string }[]).map((r) => r.id)).toEqual([pago.id]); // solo la nuestra
    expect(parOk(id, 250)).toBe(true);
  });

  it("aplicado a medias y la restauración no se verifica → 500 (nunca 2xx)", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    let n = 0;
    fake.failWhen((call) => {
      if (call.method !== "update") return false;
      n++;
      if (n === 1) {
        const first = (call.payload as { id: string; fields: Record<string, unknown> }[])[0];
        Object.assign(rows().find((r) => r.id === first.id)!.fields, first.fields);
      }
      return true; // también falla la restauración (sin aplicarse)
    }, new Error("caída"));
    expect((await editarTrf(id, { importe: "300" })).status).toBe(500);
  });

  it("las 2 nuestras después de una verificación fallida transitoria → 200", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    fake.calls.length = 0;
    fault("transferencia:editar:verificar");
    expect((await editarTrf(id, { importe: "300" })).status).toBe(200);
    expect(parOk(id, 300)).toBe(true);
    expect(updates()).toHaveLength(1);
  });

  it("las 2 originales (el update no se aplicó) → 503, no se escribe nada más", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    fake.calls.length = 0;
    fake.failWhen((call) => call.method === "update", new Error("caída"));
    expect((await editarTrf(id, { importe: "300" })).status).toBe(503);
    expect(updates()).toHaveLength(1);
    expect(parOk(id, 250)).toBe(true);
  });

  it("ajena + nuestra → 500, no se escribe nada, y la lista marca «Transferencia inconsistente»", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    fake.calls.length = 0;
    onList(2, () => {
      patas(id).cobranza.fields[M.importe] = 1; // otra persona tocó una pata
    });
    expect((await editarTrf(id, { importe: "300" })).status).toBe(500);
    expect(updates()).toHaveLength(1);
    const { pago, cobranza } = patas(id);
    expect([pago.fields[M.importe], cobranza.fields[M.importe]]).toEqual([300, 1]);
    const fila = (await list(`?cuenta=${ids.ars1}`)).json.filas.find((f: { transferencia: string }) => f.transferencia === id);
    expect(fila.control).toBe(CONTROL.transferenciaInconsistente);
  });

  it("edición: mismos valores pero otro registro (otro ID) → no se acepta", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    onList(2, () => {
      // la Cobranza fue reemplazada por un registro igual con otro ID
      const c = patas(id).cobranza;
      rows().splice(rows().indexOf(c), 1);
      rows().push({ id: "recREEMPLAZO00001", createdTime: "", fields: { ...c.fields, [M.importe]: 300 } });
    });
    const res = await editarTrf(id, { importe: "300" });
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(500);
  });

  it("alta: mismos valores pero otros registros (no los que devolvió el create) → limpieza → 503", async () => {
    onList(0, () => {
      const r = rows()[1];
      rows().splice(1, 1);
      rows().push({ id: "recREEMPLAZO00002", createdTime: "", fields: { ...r.fields } });
    });
    const res = await crearTrf(trf());
    expect(res.status).toBe(503);
    expect(rows()).toHaveLength(0);
  });

  it("par inconsistente: se detecta por cada campo y por monedas distintas; un par correcto no", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    const control = async () => (await list(`?cuenta=${ids.ars1}`)).json.filas.find((f: { transferencia: string }) => f.transferencia === id).control;
    expect(await control()).toBe(CONTROL.ok);
    const usd = ids.usd;
    for (const [field, value] of [
      [M.fecha, "2026-10-21"],
      [M.importe, 251],
      [M.tipoCambio, 2],
      [M.descripcion, "otra"],
      [M.cuenta, [usd]],
    ] as const) {
      const c = patas(id).cobranza;
      const before = c.fields[field];
      c.fields[field] = value as never;
      expect(await control(), field).toBe(CONTROL.transferenciaInconsistente);
      if (before === undefined) delete c.fields[field];
      else c.fields[field] = before;
      expect(await control()).toBe(CONTROL.ok);
    }
  });

  it("editar un par inconsistente por el formulario de transferencia lo deja consistente", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    patas(id).cobranza.fields[M.importe] = 999;
    expect((await list(`?cuenta=${ids.ars2}`)).json.filas[0].control).toBe(CONTROL.transferenciaInconsistente);
    expect((await editarTrf(id, { importe: "260" })).status).toBe(200);
    expect(parOk(id, 260)).toBe(true);
    expect((await list(`?cuenta=${ids.ars2}`)).json.filas[0].control).toBe(CONTROL.ok);
    // y se puede borrar por la ruta del par
    patas(id).cobranza.fields[M.importe] = 1;
    expect((await borrarTrf(id)).status).toBe(200);
    expect(conId(id)).toHaveLength(0);
  });

  it("edición de un par incompleto → 409", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    rows().splice(0, 1);
    expect((await editarTrf(id, { importe: "300" })).status).toBe(409);
  });

  it("borrado: los 2 en UN pedido; aplicado pero respondido con error → relectura 0 → 200", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    fake.calls.length = 0;
    fault("transferencia:borrar:respuesta");
    expect((await borrarTrf(id)).status).toBe(200);
    expect(conId(id)).toHaveLength(0);
    const deletes = fake.calls.filter((c) => c.method === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].payload as unknown[]).toHaveLength(2);
  });

  it("borrado: queda una pata → se reintenta borrar exactamente esa → 200", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    const [first] = conId(id);
    fake.calls.length = 0;
    let deletes = 0;
    fake.failWhen((call) => {
      if (call.method !== "delete" || ++deletes !== 1) return false;
      // se aplica a medias: borra solo uno y responde con error
      rows().splice(rows().findIndex((r) => r.id === first.id), 1);
      return true;
    }, new Error("caída"));
    expect((await borrarTrf(id)).status).toBe(200);
    expect(conId(id)).toHaveLength(0);
    const calls = fake.calls.filter((c) => c.method === "delete");
    expect(calls).toHaveLength(2);
    expect((calls[1].payload as string[]).length).toBe(1);
  });

  it("borrado: siguen quedando después del reintento → 500 (nunca 2xx); nunca se recrean registros", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    fake.calls.length = 0;
    fake.failWhen((call) => call.method === "delete", new Error("caída"));
    expect((await borrarTrf(id)).status).toBe(500);
    expect(fake.calls.filter((c) => c.method === "delete")).toHaveLength(2);
    expect(fake.calls.some((c) => c.method === "create")).toBe(false);
  });

  it("par incompleto: la lista lo marca «Transferencia incompleta» (primero) y el borrado de par lo elimina", async () => {
    const id = "TR-11111111-2222-3333-4444-555555555555";
    const huerfano = seedMov({ [M.transferencia]: id, [M.tipoOperacion]: [ids.transf], [M.sumaResultados]: "N" });
    const fila = (await list(`?cuenta=${ids.ars1}`)).json.filas.find((f: { id: string }) => f.id === huerfano);
    expect(fila.control).toBe(CONTROL.transferenciaIncompleta);
    expect((await list(`?cuenta=${ids.ars1}&control=transferenciaIncompleta`)).json.filas).toHaveLength(1);
    // dos Pagos con el mismo ID también es incompleto
    seedMov({ [M.transferencia]: id, [M.tipoOperacion]: [ids.transf], [M.cuenta]: [ids.ars2] });
    expect((await list(`?cuenta=${ids.ars2}`)).json.filas[0].control).toBe(CONTROL.transferenciaIncompleta);
    expect((await borrarTrf(id)).status).toBe(200);
    expect(conId(id)).toHaveLength(0);
  });

  it("un par completo y correcto no se marca", async () => {
    const id = (await crearTrf(trf())).json.transferencia;
    const filas = (await list(`?cuenta=${ids.ars1}`)).json.filas;
    expect(filas.find((f: { transferencia: string }) => f.transferencia === id).control).toBe(CONTROL.ok);
  });

  it("borrado: ID inválido o inexistente → 404", async () => {
    expect((await borrarTrf("nope")).status).toBe(404);
    expect((await borrarTrf("TR-00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });
});

describe("fechas imposibles (fix F)", () => {
  beforeEach(() => loginAs(ids.admin));

  it.each(["2026-02-31", "2026-13-01", "2025-02-29", "2026-00-10", "26-01-01"])("%s → 400 en alta, edición y transferencias", async (fecha) => {
    expect((await crear(base({ fecha }))).json).toEqual({ error: "Ingresá una fecha válida." });
    const id = seedMov({});
    expect((await editar(id, { fecha })).status).toBe(400);
    expect((await crearTrf({ cuentaOrigen: ids.ars1, cuentaDestino: ids.ars2, importe: "1", fecha })).status).toBe(400);
    const trfId = (await crearTrf({ cuentaOrigen: ids.ars1, cuentaDestino: ids.ars2, importe: "1", fecha: "2026-10-01" })).json.transferencia;
    expect((await editarTrf(trfId, { fecha })).status).toBe(400);
    expect(fake.calls.some((c) => c.method === "update")).toBe(false);
  });

  it("2024-02-29 (bisiesto) sí vale", async () => {
    expect((await crear(base({ fecha: "2024-02-29" }))).status).toBe(201);
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
