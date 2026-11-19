import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { afipRow, afipRowVentasReal, createFakeAfipSdk, type AfipRow } from "./afipsdk-fixture";
import { cuitSintetico } from "./arca-fixture";
import { createFakeAirtable } from "./fake-airtable";

/**
 * «Sincronizar con ARCA» de punta a punta (CC-F5-03): rutas + servicio + Airtable falso +
 * Afip SDK falso (fetch global). Nunca se llama a Afip SDK real. Datos sintéticos.
 */
const SECRET = "a".repeat(44);
const fake = createFakeAirtable();
const afip = createFakeAfipSdk();
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
const sincronizar = await import("@/app/api/admin/arca/[tabla]/sincronizar/route");
const estadoRoute = await import("@/app/api/admin/arca/sincronizaciones/[id]/route");
const confirmar = await import("@/app/api/admin/arca/[tabla]/confirmar/route");
const { SYNC_MESSAGES } = await import("@/lib/arca/server/sync");
const { SYNC_LOG_MESSAGES } = await import("@/lib/arca/server/sync-log");
const { PAYLOAD_MESSAGES, signPayload } = await import("@/lib/arca/server/payload");
const { MENSAJE_RECHAZO } = await import("@/lib/arca/server/afipsdk");

const T = TABLES;
const S = T.sincronizacionesArca.fields;
const U = T.usuarios.fields;

const CUIT_EMPRESA = cuitSintetico("30", 70000000);
const CUIT_LOGIN = cuitSintetico("20", 81818181);
const CLAVE = "Clave-Fiscal-Secreta!9";
const CUIT_CLIENTE = cuitSintetico("30", 11111111);
const CUIT_PROV_NUEVO = cuitSintetico("27", 44444444);

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("clave-de-prueba", 4);
});

let ids: Record<string, string>;
let consoleLines: string[];
beforeEach(() => {
  fake.reset();
  afip.reset();
  cookieJar.clear();
  clearUserCache();
  consoleLines = [];
  const capture = (...args: unknown[]) => void consoleLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.stubGlobal("fetch", afip.fetch);
  vi.stubEnv("AFIP_SDK_TOKEN", "tok_test_afip");
  const user = (email: string, rol: string) =>
    fake.seed(T.usuarios.id, { [U.nombre]: email, [U.email]: email, [U.rol]: rol, [U.sigla]: email.slice(0, 2).toUpperCase(), [U.estado]: "Activo", [U.debeCambiarPassword]: false, [U.passwordHash]: hash });
  const cat = (nombre: string, tipo: string) => fake.seed(T.categorias.id, { [T.categorias.fields.nombre]: nombre, [T.categorias.fields.tipo]: tipo });
  ids = {
    admin: user("ana@kairos.test", "Admin"),
    admin2: user("beto@kairos.test", "Admin"),
    empleado: user("eva@kairos.test", "Empleado"),
    factC: fake.seed(T.tiposComprobante.id, { [T.tiposComprobante.fields.codigo]: 11, [T.tiposComprobante.fields.signo]: 1 }),
    ncC: fake.seed(T.tiposComprobante.id, { [T.tiposComprobante.fields.codigo]: 13, [T.tiposComprobante.fields.signo]: -1 }),
    ingreso: cat("Ingresos por servicios", "Ingreso"),
    gasto: cat("Gastos varios", "Gasto"),
    cliente: fake.seed(T.clientes.id, { [T.clientes.fields.nombre]: "QA Cliente", [T.clientes.fields.sigla]: "QA", [T.clientes.fields.estado]: "Activo", [T.clientes.fields.cuit]: CUIT_CLIENTE }),
  };
  fake.seed(T.parametros.id, { [T.parametros.fields.concepto]: "Categoría por defecto en Ventas", [T.parametros.fields.valor]: "Ingresos por servicios" });
  ids.paramCuit = fake.seed(T.parametros.id, { [T.parametros.fields.concepto]: "CUIT", [T.parametros.fields.valor]: CUIT_EMPRESA });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const responses: string[] = [];
async function loginAs(userId: string) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}

async function call(handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>, url: string, params: Record<string, string>, init: { method: string; body?: unknown; headers?: Record<string, string> }) {
  const cookie = cookieJar.get(SESSION_COOKIE);
  const req = new NextRequest(`http://localhost${url}`, {
    method: init.method,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}), ...init.headers },
  });
  const res = await handler(req, { params: Promise.resolve(params) });
  const text = await res.text();
  responses.push(text);
  return { status: res.status, json: text ? JSON.parse(text) : null, cacheControl: res.headers.get("cache-control") };
}

const body = (over: Record<string, unknown> = {}) => ({ desde: "2026-10-01", hasta: "2026-10-31", usuario: CUIT_LOGIN, clave: CLAVE, ...over });
const start = (tabla: string, b: unknown = body(), headers?: Record<string, string>) => call(sincronizar.POST as never, `/api/admin/arca/${tabla}/sincronizar`, { tabla }, { method: "POST", body: b, headers });
const poll = (id: string, headers?: Record<string, string>) => call(estadoRoute.GET as never, `/api/admin/arca/sincronizaciones/${id}`, { id }, { method: "GET", headers });
const conf = (tabla: string, b: unknown, headers?: Record<string, string>) => call(confirmar.POST as never, `/api/admin/arca/${tabla}/confirmar`, { tabla }, { method: "POST", body: b, headers });

const logs = () => fake.rows(T.sincronizacionesArca.id);
const log = (id: string) => logs().find((r) => r.id === id)!.fields;

/** Sincroniza hasta la vista previa: start → poll en proceso → poll completo. */
async function syncToPreview(tabla: "ventas" | "compras", rows: AfipRow[]) {
  const s = await start(tabla);
  expect(s.status).toBe(200);
  afip.onGet({ status: 200, body: { status: "in_process" } });
  expect((await poll(s.json.syncId)).json).toEqual({ ok: true, estado: "en_proceso" });
  afip.complete(rows);
  const p = await poll(s.json.syncId);
  expect(p.status).toBe(200);
  return { syncId: s.json.syncId as string, preview: p.json.preview, payload: p.json.payload as string };
}

const ventasRows = () => [
  afipRow("ventas", { "Número Desde": "1", "Número Hasta": "1", "Nro. Doc. Receptor": CUIT_CLIENTE, "Imp. Total": "1210,00", IVA: "210,00" }),
  afipRow("ventas", { "Tipo de Comprobante": "13 - Nota de Crédito C", "Número Desde": "2", "Nro. Doc. Receptor": CUIT_CLIENTE, "Imp. Total": "100,50" }),
  afipRow("ventas", { "Tipo de Comprobante": "Factura C", "Número Desde": "3" }),
];

describe("flujo Ventas: sincronizar → vista previa → importar", () => {
  beforeEach(() => loginAs(ids.admin));

  it("crea el log «En proceso» con Job ID, consulta, arma la misma vista previa y escribe con confirmImport", async () => {
    const s = await start("ventas");
    expect(s).toMatchObject({ status: 200, json: { ok: true, syncId: expect.stringMatching(/^rec/) }, cacheControl: "no-store" });
    const l = log(s.json.syncId);
    expect(l).toMatchObject({ [S.tipo]: "Ventas", [S.desde]: "2026-10-01", [S.hasta]: "2026-10-31", [S.usuario]: [ids.admin], [S.estado]: "En proceso", [S.jobId]: "job-0001" });
    expect(String(l[S.sincronizacion])).toMatch(/^Ventas · 01\/10\/2026–31\/10\/2026 · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
    // La CUIT de la empresa sale de Parámetros; t = E; el período en dd/mm/yyyy.
    expect(afip.requests[0].body).toEqual({ automation: "mis-comprobantes", params: { cuit: CUIT_EMPRESA, username: CUIT_LOGIN, password: CLAVE, filters: { t: "E", fechaEmision: "01/10/2026 - 31/10/2026" } } });

    afip.complete(ventasRows());
    const p = await poll(s.json.syncId);
    expect(p.json.estado).toBe("lista");
    expect(p.json.preview.resumen).toEqual({ total: 3, nuevas: 2, yaImportadas: 0, duplicadas: 0, conError: 1 });
    expect(p.json.preview.filas.map((f: { fila: number }) => f.fila)).toEqual([1, 2, 3]);
    expect(p.json.preview.filas[0]).toMatchObject({ clave: `11|2|1|${CUIT_CLIENTE}`, clientePorCuit: { id: ids.cliente } });
    expect(log(s.json.syncId)).toMatchObject({ [S.estado]: "Lista para revisar", [S.leidas]: 3, [S.nuevas]: 2, [S.yaImportadas]: 0, [S.duplicadas]: 0, [S.conError]: 1 });

    const c = await conf("ventas", { syncId: s.json.syncId, payload: p.json.payload, ediciones: {} });
    expect(c.status).toBe(200);
    expect(c.json).toMatchObject({ importadas: 2, omitidas: { yaImportadas: 0, duplicadasEnArchivo: 0, enParalelo: 0 }, conError: [{ fila: 3, motivo: "Tipo de comprobante no reconocido" }] });
    const ventas = fake.rows(T.ventas.id);
    expect(ventas.map((r) => r.fields[T.ventas.fields.claveArca]).sort()).toEqual([`11|2|1|${CUIT_CLIENTE}`, `13|2|2|${CUIT_CLIENTE}`]);
    expect(ventas.find((r) => r.fields[T.ventas.fields.numeroDesde] === 1)!.fields).toMatchObject({ [T.ventas.fields.impTotal]: 1210, [T.ventas.fields.totalIva]: 210, [T.ventas.fields.cliente]: [ids.cliente] });
    expect(log(s.json.syncId)).toMatchObject({ [S.estado]: "Importada", [S.importadas]: 2 });

    // Replay: la misma confirmación otra vez → 409 sin escribir.
    const again = await conf("ventas", { syncId: s.json.syncId, payload: p.json.payload, ediciones: {} });
    expect(again).toMatchObject({ status: 409, json: { error: SYNC_MESSAGES.importada } });
    expect(fake.rows(T.ventas.id)).toHaveLength(2);

    // Re-sincronizar el mismo período → todo «Ya importada».
    afip.reset();
    const again2 = await syncToPreview("ventas", ventasRows());
    expect(again2.preview.resumen).toMatchObject({ nuevas: 0, yaImportadas: 2, conError: 1 });
  });

  it("las ediciones se validan igual que en el .xlsx, con «comprobante N»", async () => {
    const { syncId, payload } = await syncToPreview("ventas", ventasRows());
    const c = await conf("ventas", { syncId, payload, ediciones: { [`11|2|1|${CUIT_CLIENTE}`]: { categoria: ids.gasto } } });
    expect(c).toMatchObject({ status: 400, json: { error: "Revisá el comprobante 1: elegí una categoría de ingreso." } });
    expect(fake.rows(T.ventas.id)).toHaveLength(0);
  });

  it("falla inyectada al escribir → rollback (503), el log sigue «Lista para revisar» y se puede reintentar", async () => {
    const { syncId, payload } = await syncToPreview("ventas", ventasRows());
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "import:ventas:0");
    const c = await conf("ventas", { syncId, payload, ediciones: {} });
    expect(c).toMatchObject({ status: 503, json: { error: "No pudimos completar el cambio. No se modificó nada; probá de nuevo." } });
    expect(fake.rows(T.ventas.id)).toHaveLength(0);
    expect(log(syncId)[S.estado]).toBe("Lista para revisar");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "");
    expect((await conf("ventas", { syncId, payload, ediciones: {} })).status).toBe(200);
  });

  it("sin comprobantes en el período → mensaje informativo, log «Lista para revisar» con 0", async () => {
    const s = await start("ventas");
    afip.complete([]);
    const p = await poll(s.json.syncId);
    expect(p.json).toEqual({ ok: true, estado: "sin_comprobantes", mensaje: "ARCA no devolvió comprobantes para ese período." });
    expect(log(s.json.syncId)).toMatchObject({ [S.estado]: "Lista para revisar", [S.leidas]: 0 });
  });
});

describe("flujo Compras", () => {
  beforeEach(() => loginAs(ids.admin));

  it("t = R; crea el proveedor nuevo; sin columnas del receptor", async () => {
    const rows = [afipRow("compras", { "Nro. Doc. Emisor": CUIT_PROV_NUEVO, "Denominación Emisor": "QA Proveedor nuevo" })];
    const { syncId, preview, payload } = await syncToPreview("compras", rows);
    expect((afip.requests[0].body as { params: { filters: { t: string } } }).params.filters.t).toBe("R");
    expect(preview.proveedoresNuevos).toEqual([{ nombre: "QA Proveedor nuevo", cuit: CUIT_PROV_NUEVO }]);
    const c = await conf("compras", { syncId, payload, ediciones: {} });
    expect(c.json).toMatchObject({ importadas: 1, proveedoresCreados: [{ nombre: "QA Proveedor nuevo", cuit: CUIT_PROV_NUEVO }] });
    const prov = fake.rows(T.proveedores.id);
    expect(prov).toHaveLength(1);
    expect(fake.rows(T.compras.id)[0].fields[T.compras.fields.proveedor]).toEqual([prov[0].id]);
  });

  it("respuesta sin columnas del Emisor → diagnóstico (solo nombres) y log «Error»", async () => {
    const s = await start("compras");
    afip.complete([afipRow("ventas", { "Nro. Doc. Receptor": CUIT_CLIENTE, "Denominación Receptor": "Nombre real que no se muestra" })]);
    const p = await poll(s.json.syncId);
    expect(p.status).toBe(400);
    expect(p.json.error).toMatch(/^Faltan columnas en la respuesta de ARCA: «Tipo Doc\. Emisor», «Nro\. Doc\. Emisor», «Denominación Emisor» · Columnas recibidas: Fecha de Emisión, /);
    expect(p.json.error).not.toContain("Nombre real que no se muestra");
    expect(p.json.error).not.toContain(CUIT_CLIENTE);
    expect(log(s.json.syncId)).toMatchObject({ [S.estado]: "Error", [S.mensaje]: p.json.error });
    // Una vez en Error, consultar de nuevo no vuelve a llamar a Afip SDK.
    const before = afip.requests.length;
    expect((await poll(s.json.syncId)).status).toBe(400);
    expect(afip.requests).toHaveLength(before);
  });
});

describe("validaciones y configuración", () => {
  beforeEach(() => loginAs(ids.admin));

  it("sin AFIP_SDK_TOKEN → 503 «no está configurada» en las tres rutas, sin tocar nada", async () => {
    vi.stubEnv("AFIP_SDK_TOKEN", "");
    const msg = { error: "La sincronización con ARCA no está configurada." };
    expect(await start("ventas")).toMatchObject({ status: 503, json: msg });
    expect(await poll("rec00000000000001")).toMatchObject({ status: 503, json: msg });
    expect(await conf("ventas", { syncId: "rec00000000000001", payload: "x" })).toMatchObject({ status: 503, json: msg });
    expect(afip.requests).toEqual([]);
    expect(logs()).toEqual([]);
  });

  it("Parámetros «CUIT» vacía o inválida → 400, sin llamar a Afip SDK", async () => {
    const P = T.parametros.fields;
    for (const valor of ["", "20-12345678-0"]) {
      fake.rows(T.parametros.id).find((r) => r.id === ids.paramCuit)!.fields[P.valor] = valor;
      expect(await start("ventas")).toMatchObject({ status: 400, json: { error: "Completá la CUIT de la empresa en Parámetros antes de sincronizar con ARCA." } });
    }
    expect(afip.requests).toEqual([]);
    expect(logs()).toEqual([]);
  });

  it("una «cuit» (o cualquier otro campo) en el body se rechaza: la CUIT es siempre la de Parámetros", async () => {
    expect(await start("ventas", body({ cuit: "30111111118" }))).toMatchObject({ status: 400, json: { error: SYNC_MESSAGES.campos } });
    expect(afip.requests).toEqual([]);
  });

  it("período: desde > hasta, hasta > hoy, más de 366 días, fechas inválidas; usuario y clave", async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const cases: [Record<string, unknown>, string][] = [
      [{ desde: "2026-10-31", hasta: "2026-10-01" }, SYNC_MESSAGES.orden],
      [{ hasta: future }, SYNC_MESSAGES.futuro],
      [{ desde: "2025-01-01", hasta: "2026-01-02" }, SYNC_MESSAGES.rango],
      [{ desde: "01/10/2026" }, SYNC_MESSAGES.fechas],
      [{ usuario: "20-12345678-0" }, SYNC_MESSAGES.usuario],
      [{ clave: "" }, SYNC_MESSAGES.clave],
    ];
    for (const [over, error] of cases) expect(await start("ventas", body(over))).toMatchObject({ status: 400, json: { error } });
    // 366 días exactos sí.
    expect((await start("ventas", body({ desde: "2025-01-01", hasta: "2026-01-01" }))).status).toBe(200);
    expect(afip.requests).toHaveLength(1);
  });

  it("tabla desconocida 404; no JSON 415; Origin de otro sitio 403", async () => {
    expect((await start("tesoreria")).status).toBe(404);
    expect((await call(sincronizar.POST as never, "/api/admin/arca/ventas/sincronizar", { tabla: "ventas" }, { method: "POST", body: "desde=1", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(await start("ventas", body(), { origin: "https://evil.example" })).toMatchObject({ status: 403 });
    expect(await poll("rec00000000000001", { origin: "https://evil.example" })).toMatchObject({ status: 403 });
    expect(await conf("ventas", { syncId: "rec00000000000001", payload: "x" }, { origin: "https://evil.example" })).toMatchObject({ status: 403 });
    expect(afip.requests).toEqual([]);
  });
});

describe("auth", () => {
  it("sin sesión → 401; Empleado → 403, en las tres rutas, sin leer nada", async () => {
    for (const r of [await start("ventas"), await poll("rec00000000000001"), await conf("ventas", { syncId: "rec00000000000001", payload: "x" })]) expect(r.status).toBe(401);
    await loginAs(ids.empleado);
    fake.calls.length = 0;
    for (const r of [await start("ventas"), await poll("rec00000000000001"), await conf("ventas", { syncId: "rec00000000000001", payload: "x" })]) expect(r.status).toBe(403);
    expect(fake.calls.filter((c) => c.tableId === T.sincronizacionesArca.id || c.tableId === T.parametros.id)).toEqual([]);
    expect(afip.requests).toEqual([]);
  });

  it("la sincronización de otro Admin: consultar y confirmar → 403", async () => {
    await loginAs(ids.admin);
    const { syncId, payload } = await syncToPreview("ventas", ventasRows());
    await loginAs(ids.admin2);
    expect(await poll(syncId)).toMatchObject({ status: 403, json: { error: SYNC_MESSAGES.otroUsuario } });
    expect(await conf("ventas", { syncId, payload, ediciones: {} })).toMatchObject({ status: 403 });
  });
});

describe("errores de Afip SDK", () => {
  beforeEach(() => loginAs(ids.admin));

  it("create 400 → 400 con el mensaje (limpio) y log «Error» con ese mensaje", async () => {
    afip.onCreate({ status: 400, body: { status: "error", data: { message: `Usuario ${CUIT_LOGIN} o clave incorrecta` } } });
    const s = await start("ventas");
    expect(s).toMatchObject({ status: 400, json: { error: "Usuario [redactado] o clave incorrecta" } });
    expect(logs()).toHaveLength(1);
    expect(logs()[0].fields).toMatchObject({ [S.estado]: "Error", [S.mensaje]: "Usuario [redactado] o clave incorrecta" });
  });

  it("401 → 503 «no está configurada correctamente»; 5xx en el create → 503 sin reintentar", async () => {
    afip.onCreate({ status: 401 });
    expect(await start("ventas")).toMatchObject({ status: 503, json: { error: "La integración con ARCA no está configurada correctamente." } });
    afip.onCreate({ status: 502 });
    expect(await start("ventas")).toMatchObject({ status: 503, json: { error: "ARCA no respondió; probá de nuevo en unos minutos." } });
    expect(afip.requests.filter((r) => r.method === "POST")).toHaveLength(2);
  });

  it("job con error al consultar → 400 y log «Error»; transitorio (5xx) → 503 y el log sigue «En proceso»", async () => {
    const s = await start("ventas");
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as never);
    afip.onGet({ status: 503 });
    expect(await poll(s.json.syncId)).toMatchObject({ status: 503 });
    expect(log(s.json.syncId)[S.estado]).toBe("En proceso");
    afip.onGet({ status: 400, body: { status: "error", data: { message: "No se pudo ingresar a ARCA" } } });
    expect(await poll(s.json.syncId)).toMatchObject({ status: 400, json: { error: MENSAJE_RECHAZO } });
    expect(log(s.json.syncId)).toMatchObject({ [S.estado]: "Error", [S.mensaje]: MENSAJE_RECHAZO });
  });

  it("más de 15 minutos «En proceso» → «Vencida» con error", async () => {
    const id = fake.seed(T.sincronizacionesArca.id, { [S.tipo]: "Ventas", [S.usuario]: [ids.admin], [S.estado]: "En proceso", [S.jobId]: "job-9", [S.iniciada]: new Date(Date.now() - 16 * 60_000).toISOString() });
    expect(await poll(id)).toMatchObject({ status: 400, json: { error: SYNC_MESSAGES.vencida } });
    expect(log(id)[S.estado]).toBe("Vencida");
    expect(afip.requests).toEqual([]);
  });
});

describe("guardas (desde la tabla de log)", () => {
  beforeEach(() => loginAs(ids.admin));
  const seedLog = (fields: Record<string, unknown>) => fake.seed(T.sincronizacionesArca.id, { [S.tipo]: "Ventas", [S.usuario]: [ids.admin], ...fields });
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  it("otra «En proceso» de la misma tabla en los últimos 15 min → 409; de otra tabla o vieja, no", async () => {
    seedLog({ [S.estado]: "En proceso", [S.jobId]: "job-x", [S.iniciada]: ago(5), [S.usuario]: [ids.admin2] });
    expect(await start("ventas")).toMatchObject({ status: 409, json: { error: SYNC_LOG_MESSAGES.enCurso("ventas") } });
    expect((await start("compras")).status).toBe(200);
    fake.reset();
    afip.reset();
  });

  it("una «En proceso» de más de 15 minutos no bloquea", async () => {
    seedLog({ [S.estado]: "En proceso", [S.iniciada]: ago(20) });
    expect((await start("ventas")).status).toBe(200);
  });

  it("5 «Error» del mismo Admin en 15 min → 429; 4, o de otro Admin, o hace más de 15 min → no", async () => {
    for (let i = 0; i < 4; i++) seedLog({ [S.estado]: "Error", [S.iniciada]: ago(10), [S.finalizada]: ago(10 - i) });
    seedLog({ [S.estado]: "Error", [S.iniciada]: ago(3), [S.finalizada]: ago(2), [S.usuario]: [ids.admin2] });
    expect((await start("ventas")).status).toBe(200);
    fake.rows(T.sincronizacionesArca.id).length = 0;
    for (let i = 0; i < 5; i++) seedLog({ [S.estado]: "Error", [S.iniciada]: ago(10), [S.finalizada]: ago(10 - i) });
    expect(await start("ventas")).toMatchObject({ status: 429, json: { error: "Demasiados intentos fallidos. Esperá 15 minutos para no bloquear tu clave fiscal en ARCA." } });
    expect(afip.requests).toHaveLength(1);
    fake.rows(T.sincronizacionesArca.id).length = 0;
    for (let i = 0; i < 5; i++) seedLog({ [S.estado]: "Error", [S.iniciada]: ago(30), [S.finalizada]: ago(29 - i) });
    expect((await start("ventas")).status).toBe(200);
  });

  it("los errores de create cuentan: el 6.º intento seguido queda bloqueado", async () => {
    afip.onCreate({ status: 400, body: { status: "error", data: { message: "Clave incorrecta" } } });
    for (let i = 0; i < 5; i++) expect((await start("ventas")).status).toBe(400);
    expect((await start("ventas")).status).toBe(429);
    expect(afip.requests).toHaveLength(5);
  });

  it("no se puede leer el log → 503 (falla cerrado), sin llamar a Afip SDK", async () => {
    fake.fail("list", T.sincronizacionesArca.id);
    expect(await start("ventas")).toMatchObject({ status: 503, json: { error: SYNC_LOG_MESSAGES.noDisponible } });
    expect(afip.requests).toEqual([]);
  });

  it("carrera: dos inicios a la vez → solo uno llama a Afip SDK; el otro borra su log y responde 409", async () => {
    fake.barrier("create", T.sincronizacionesArca.id, 2);
    const [a, b] = await Promise.all([start("ventas"), start("ventas")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(afip.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(logs()).toHaveLength(1);
  });
});

describe("payload firmado", () => {
  beforeEach(() => loginAs(ids.admin));

  it("alterado → 400; de otra sincronización → 400; vencido → 400; sin escribir", async () => {
    const { syncId, payload } = await syncToPreview("ventas", ventasRows());
    const [data, sig] = payload.split(".");
    const tampered = Buffer.from(Buffer.from(data, "base64url").toString().replace("1210,00", "9999,00")).toString("base64url");
    expect(await conf("ventas", { syncId, payload: `${tampered}.${sig}`, ediciones: {} })).toMatchObject({ status: 400, json: { error: PAYLOAD_MESSAGES.invalido } });
    const other = signPayload(SECRET, { syncId: "rec00000000000077", tabla: "ventas", userId: ids.admin, issuedAt: Date.now() }, []);
    expect(await conf("ventas", { syncId, payload: other, ediciones: {} })).toMatchObject({ status: 400, json: { error: PAYLOAD_MESSAGES.otraSincronizacion } });
    const old = signPayload(SECRET, { syncId, tabla: "ventas", userId: ids.admin, issuedAt: Date.now() - 2 * 3_600_000 - 1 }, []);
    expect(await conf("ventas", { syncId, payload: old, ediciones: {} })).toMatchObject({ status: 400, json: { error: PAYLOAD_MESSAGES.vencido } });
    expect(await conf("compras", { syncId, payload, ediciones: {} })).toMatchObject({ status: 400 });
    expect(await conf("ventas", { syncId, payload, ediciones: {}, extra: 1 })).toMatchObject({ status: 400, json: { error: SYNC_MESSAGES.campos } });
    expect(fake.rows(T.ventas.id)).toHaveLength(0);
  });

  it("firmado para otro usuario → 403", async () => {
    const { syncId } = await syncToPreview("ventas", ventasRows());
    const foreign = signPayload(SECRET, { syncId, tabla: "ventas", userId: ids.admin2, issuedAt: Date.now() }, []);
    expect(await conf("ventas", { syncId, payload: foreign, ediciones: {} })).toMatchObject({ status: 403 });
  });

  it("confirmar antes de estar lista → 409", async () => {
    const s = await start("ventas");
    expect(await conf("ventas", { syncId: s.json.syncId, payload: "x.y", ediciones: {} })).toMatchObject({ status: 409, json: { error: SYNC_MESSAGES.noLista } });
  });
});

describe("secretos: la clave fiscal y el usuario ARCA nunca salen del pedido a Afip SDK", () => {
  beforeEach(() => loginAs(ids.admin));

  it("ni en logs de consola, ni en escrituras de Airtable, ni en respuestas (éxito y error)", async () => {
    responses.length = 0;
    const formatted = `${CUIT_LOGIN.slice(0, 2)}-${CUIT_LOGIN.slice(2, 10)}-${CUIT_LOGIN[10]}`;
    // Éxito completo.
    const { syncId, payload } = await syncToPreview("ventas", ventasRows());
    await conf("ventas", { syncId, payload, ediciones: {} });
    // Errores que podrían devolver el usuario: 400 con eco, 401, 5xx, red.
    afip.onCreate({ status: 400, body: { status: "error", data: { message: `Usuario ${CUIT_LOGIN} (${formatted}) clave ${CLAVE} inválida` } } });
    await start("compras");
    afip.onCreate({ status: 401, body: { message: `token for ${CUIT_LOGIN}` } });
    await start("compras");
    afip.onCreate("network");
    await start("compras");

    const airtableWrites = JSON.stringify(fake.calls.filter((c) => c.method !== "list").map((c) => c.payload));
    const everything = [consoleLines.join("\n"), airtableWrites, responses.join("\n")];
    for (const text of everything) {
      expect(text).not.toContain(CLAVE);
      expect(text).not.toContain(CUIT_LOGIN);
      expect(text).not.toContain(formatted);
    }
    // Las credenciales solo fueron a Afip SDK.
    expect(afip.requests.filter((r) => JSON.stringify(r.body ?? "").includes(CLAVE))).toHaveLength(4);
  });
});

describe("CC-F5-04 · F-01/F-02: los mensajes del proveedor nunca filtran la clave", () => {
  beforeEach(() => loginAs(ids.admin));
  const everywhere = () => [responses.join("\n"), JSON.stringify(logs().map((r) => r.fields)), consoleLines.join("\n")];

  it("error del job (GET 400 y 200 status error) con la clave exacta en el mensaje → mensaje fijo; la clave no aparece en ningún lado", async () => {
    for (const reply of [
      { status: 400, body: { status: "error", data: { message: `La clave ${CLAVE} del usuario ${CUIT_LOGIN} venció` } } },
      { status: 200, body: { status: "error", data: { message: `La clave ${CLAVE} del usuario ${CUIT_LOGIN} venció` } } },
    ]) {
      fake.rows(T.sincronizacionesArca.id).length = 0;
      responses.length = 0;
      const s = await start("ventas");
      afip.onGet(reply);
      const p = await poll(s.json.syncId);
      expect(p).toMatchObject({ status: 400, json: { error: MENSAJE_RECHAZO } });
      expect(log(s.json.syncId)).toMatchObject({ [S.estado]: "Error", [S.mensaje]: MENSAJE_RECHAZO });
      for (const text of everywhere()) {
        expect(text).not.toContain(CLAVE);
        expect(text).not.toContain(CUIT_LOGIN);
      }
    }
  });

  it("create 400 que repite una clave de 1, 3 o 5 caracteres, o con caracteres de control → mensaje fijo; ausente en todos lados", async () => {
    for (const clave of ["§", "§¶‡", "§¶‡µ¤", "ab\u0007cdefgh"]) {
      fake.rows(T.sincronizacionesArca.id).length = 0;
      responses.length = 0;
      consoleLines.length = 0;
      afip.onCreate({ status: 400, body: { status: "error", data: { message: `Usuario ${CUIT_LOGIN} o clave ${clave} incorrectos` } } });
      const s = await start("ventas", body({ clave }));
      expect(s).toMatchObject({ status: 400, json: { error: MENSAJE_RECHAZO } });
      expect(logs()[0].fields[S.mensaje]).toBe(MENSAJE_RECHAZO);
      const stripped = clave.replace(/[\u0000-\u001f]/g, "");
      for (const text of everywhere()) {
        expect(text).not.toContain(clave);
        expect(text).not.toContain(stripped);
        expect(text).not.toContain(CUIT_LOGIN);
      }
    }
  });
});

describe("CC-F5-04 · F-05: datos no primitivos en la respuesta", () => {
  beforeEach(() => loginAs(ids.admin));

  it("objeto/array en Nro. Doc. Receptor o en un importe → error de fila sin Clave ARCA; no se importa", async () => {
    const rows = [
      afipRow("ventas", { "Número Desde": "1", "Nro. Doc. Receptor": { cuit: CUIT_CLIENTE } as unknown as string }),
      afipRow("ventas", { "Número Desde": "2", "Nro. Doc. Receptor": CUIT_CLIENTE, "Imp. Total": ["1000,00"] as unknown as string }),
      afipRow("ventas", { "Número Desde": "3", "Nro. Doc. Receptor": CUIT_CLIENTE }),
    ];
    const { syncId, preview, payload } = await syncToPreview("ventas", rows);
    expect(preview.filas.map((f: { estado: string; clave: string | null; error: string | null }) => [f.estado, f.clave, f.error])).toEqual([
      ["error", null, "Dato inválido en la respuesta de ARCA (columna «Nro. Doc. Receptor»)."],
      ["error", null, "Dato inválido en la respuesta de ARCA (columna «Imp. Total»)."],
      ["nueva", `11|2|3|${CUIT_CLIENTE}`, null],
    ]);
    const c = await conf("ventas", { syncId, payload, ediciones: {} });
    expect(c.json).toMatchObject({ importadas: 1, conError: [{ fila: 1 }, { fila: 2 }] });
    expect(fake.rows(T.ventas.id).map((r) => r.fields[T.ventas.fields.claveArca])).toEqual([`11|2|3|${CUIT_CLIENTE}`]);
  });
});

describe("CC-F5-04 · F-07: limpieza del inicio que pierde la carrera", () => {
  beforeEach(() => loginAs(ids.admin));
  const finish = (id: string) => void (log(id)[S.estado] = "Importada");

  it("el borrado del perdedor falla → queda «Vencida» con «Inicio duplicado descartado.»; un inicio nuevo no queda bloqueado", async () => {
    fake.barrier("create", T.sincronizacionesArca.id, 2);
    fake.fail("delete", T.sincronizacionesArca.id);
    const [a, b] = await Promise.all([start("ventas"), start("ventas")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = logs().find((r) => r.fields[S.estado] === "Vencida")!;
    expect(loser.fields).toMatchObject({ [S.mensaje]: "Inicio duplicado descartado.", [S.finalizada]: expect.any(String) });
    expect(afip.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    finish((a.status === 200 ? a : b).json.syncId);
    expect((await start("ventas")).status).toBe(200);
  });

  it("borrado y paso a «Vencida» fallan → 503; ese registro bloquea la tabla 15 minutos (falla cerrado, CC-F5-05)", async () => {
    fake.barrier("create", T.sincronizacionesArca.id, 2);
    fake.fail("delete", T.sincronizacionesArca.id);
    fake.failWhen((call) => call.method === "update" && call.tableId === T.sincronizacionesArca.id && (call.payload as { fields: Record<string, unknown> }[])[0].fields[S.estado] === "Vencida");
    const [a, b] = await Promise.all([start("ventas"), start("ventas")]);
    expect([a.status, b.status].sort()).toEqual([200, 503]);
    const winner = (a.status === 200 ? a : b).json.syncId;
    const stuck = logs().find((r) => r.id !== winner)!;
    expect(stuck.fields).toMatchObject({ [S.estado]: "En proceso" });
    expect(stuck.fields[S.jobId]).toBeUndefined();
    expect(consoleLines.join("\n")).toContain(`"id":"${stuck.id}"`);
    finish(winner);
    // Un «En proceso» sin Job ID cuenta los 15 minutos completos.
    stuck.fields[S.iniciada] = new Date(Date.now() - 14 * 60_000).toISOString();
    expect((await start("ventas")).status).toBe(409);
    stuck.fields[S.iniciada] = new Date(Date.now() - 16 * 60_000).toISOString();
    expect((await start("ventas")).status).toBe(200);
  });

  it("«Vencida» nunca cuenta para la guarda de en curso ni para el bloqueo por errores", async () => {
    for (let i = 0; i < 6; i++) fake.seed(T.sincronizacionesArca.id, { [S.tipo]: "Ventas", [S.usuario]: [ids.admin], [S.estado]: "Vencida", [S.jobId]: "job-v", [S.iniciada]: new Date().toISOString(), [S.finalizada]: new Date().toISOString() });
    expect((await start("ventas")).status).toBe(200);
  });
});

describe("CC-F5-04: el log no se puede marcar «Importada» después de importar", () => {
  beforeEach(() => loginAs(ids.admin));

  it("la respuesta informa la importación; el log se registra solo por ID; repetir la confirmación no escribe nada nuevo", async () => {
    const { syncId, payload } = await syncToPreview("ventas", ventasRows());
    fake.failWhen((call) => call.method === "update" && call.tableId === T.sincronizacionesArca.id && (call.payload as { fields: Record<string, unknown> }[])[0].fields[S.estado] === "Importada", new Error(`falla con ${CLAVE}`));
    consoleLines.length = 0;
    const c = await conf("ventas", { syncId, payload, ediciones: {} });
    expect(c).toMatchObject({ status: 200, json: { importadas: 2 } });
    expect(log(syncId)[S.estado]).toBe("Lista para revisar");
    const line = consoleLines.find((l) => l.includes("No se pudo actualizar el log"))!;
    expect(line).toBe(`[arca] No se pudo actualizar el log de la sincronización {"id":"${syncId}"}`);
    expect(consoleLines.join("\n")).not.toContain(CLAVE);
    const before = fake.rows(T.ventas.id).length;
    const again = await conf("ventas", { syncId, payload, ediciones: {} });
    expect(again).toMatchObject({ status: 200, json: { importadas: 0, omitidas: { yaImportadas: 2 } } });
    expect(fake.rows(T.ventas.id)).toHaveLength(before);
  });
});

describe("CC-F5-05 · F-08: posiciones de las filas de ARCA", () => {
  beforeEach(() => loginAs(ids.admin));
  const vacia = () => Object.fromEntries(Object.keys(afipRow("ventas")).map((k) => [k, null])) as AfipRow;

  it("fila vacía salvo un objeto/array, antes de una válida → error sin Clave; la válida sigue «nueva» con su número; se importa solo la válida", async () => {
    for (const bad of [{ cuit: CUIT_CLIENTE }, [CUIT_CLIENTE]]) {
      fake.rows(T.sincronizacionesArca.id).length = 0;
      fake.rows(T.ventas.id).length = 0;
      afip.reset();
      const rows = [{ ...vacia(), "Nro. Doc. Receptor": bad as unknown as string }, afipRow("ventas", { "Número Desde": "5", "Nro. Doc. Receptor": CUIT_CLIENTE })];
      const { syncId, preview, payload } = await syncToPreview("ventas", rows);
      expect(preview.filas.map((f: { fila: number; estado: string; clave: string | null; error: string | null }) => [f.fila, f.estado, f.clave, f.error])).toEqual([
        [1, "error", null, "Dato inválido en la respuesta de ARCA (columna «Nro. Doc. Receptor»)."],
        [2, "nueva", `11|2|5|${CUIT_CLIENTE}`, null],
      ]);
      const c = await conf("ventas", { syncId, payload, ediciones: {} });
      expect(c.json).toMatchObject({ importadas: 1, conError: [{ fila: 1, motivo: "Dato inválido en la respuesta de ARCA (columna «Nro. Doc. Receptor»)." }] });
      expect(fake.rows(T.ventas.id).map((r) => r.fields[T.ventas.fields.claveArca])).toEqual([`11|2|5|${CUIT_CLIENTE}`]);
    }
  });

  it("fila completamente vacía antes de una válida → «Comprobante vacío…», sin Clave; la válida conserva su número y es la única importada", async () => {
    const rows = [vacia(), {}, afipRow("ventas", { "Número Desde": "6", "Nro. Doc. Receptor": CUIT_CLIENTE })];
    const { syncId, preview, payload } = await syncToPreview("ventas", rows);
    expect(preview.filas.map((f: { fila: number; estado: string; clave: string | null; error: string | null }) => [f.fila, f.estado, f.clave, f.error])).toEqual([
      [1, "error", null, "Comprobante vacío en la respuesta de ARCA."],
      [2, "error", null, "Comprobante vacío en la respuesta de ARCA."],
      [3, "nueva", `11|2|6|${CUIT_CLIENTE}`, null],
    ]);
    const c = await conf("ventas", { syncId, payload, ediciones: { [`11|2|6|${CUIT_CLIENTE}`]: { observaciones: "QA" } } });
    expect(c.json).toMatchObject({ importadas: 1, conError: [{ fila: 1 }, { fila: 2 }] });
    expect(fake.rows(T.ventas.id)).toHaveLength(1);
    expect(fake.rows(T.ventas.id)[0].fields[T.ventas.fields.observaciones]).toBe("QA");
  });
});

describe("CC-F5-05 · F-09: el Job ID no se pudo registrar", () => {
  beforeEach(() => loginAs(ids.admin));

  it("create OK y el patch del Job ID falla → 503 con el mensaje; un solo create; la tabla queda bloqueada 15 minutos", async () => {
    let patchFails = true;
    fake.failWhen((call) => patchFails && call.method === "update" && call.tableId === T.sincronizacionesArca.id && S.jobId in (call.payload as { fields: Record<string, unknown> }[])[0].fields);
    consoleLines.length = 0;
    const s = await start("ventas");
    expect(s).toMatchObject({ status: 503, json: { error: "La consulta a ARCA se inició pero no se pudo registrar. Esperá 15 minutos antes de volver a sincronizar." } });
    expect(afip.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    const row = logs()[0];
    expect(row.fields).toMatchObject({ [S.estado]: "En proceso" });
    expect(row.fields[S.jobId]).toBeUndefined();
    expect(consoleLines.find((l) => l.includes("sin registrar el Job ID"))).toBe(`[arca] Job creado pero sin registrar el Job ID {"id":"${row.id}"}`);
    // Dentro de los 15 minutos → 409, sin otro create.
    expect((await start("ventas")).status).toBe(409);
    row.fields[S.iniciada] = new Date(Date.now() - 14 * 60_000).toISOString();
    expect((await start("ventas")).status).toBe(409);
    expect(afip.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    // Consultarla no la termina en Error (seguiría bloqueando sin poder verse): sigue en proceso.
    expect((await poll(row.id)).json).toEqual({ ok: true, estado: "en_proceso" });
    // Pasados 15 minutos → permitido (y al consultarla queda «Vencida»).
    patchFails = false;
    row.fields[S.iniciada] = new Date(Date.now() - 16 * 60_000).toISOString();
    expect((await start("ventas")).status).toBe(200);
    expect((await poll(row.id)).status).toBe(400);
    expect(row.fields[S.estado]).toBe("Vencida");
  });
});

describe("CC-F5-05: create 200 con status «error» que repite la clave y la CUIT de login", () => {
  beforeEach(() => loginAs(ids.admin));

  it("no aparecen en la respuesta, el log ni la consola", async () => {
    responses.length = 0;
    consoleLines.length = 0;
    const formatted = `${CUIT_LOGIN.slice(0, 2)}-${CUIT_LOGIN.slice(2, 10)}-${CUIT_LOGIN[10]}`;
    afip.onCreate({ status: 200, body: { status: "error", data: { message: `Usuario ${CUIT_LOGIN} (${formatted}) con clave ${CLAVE} rechazado` } } });
    const s = await start("ventas");
    expect(s.status).toBe(400);
    for (const text of [responses.join("\n"), JSON.stringify(logs().map((r) => r.fields)), consoleLines.join("\n")]) {
      expect(text).not.toContain(CLAVE);
      expect(text).not.toContain(CUIT_LOGIN);
      expect(text).not.toContain(formatted);
    }
    expect(logs()[0].fields).toMatchObject({ [S.estado]: "Error" });
  });
});

describe("CC-F5-07: respuesta real de Ventas de punta a punta", () => {
  beforeEach(() => loginAs(ids.admin));

  it("vista previa → confirmar escribe Neto Gravado Total y las 11 columnas por alícuota", async () => {
    const tipoA = fake.seed(T.tiposComprobante.id, { [T.tiposComprobante.fields.codigo]: 1, [T.tiposComprobante.fields.signo]: 1 });
    const { syncId, preview, payload } = await syncToPreview("ventas", [afipRowVentasReal({ "Nro. Doc. Receptor": CUIT_CLIENTE })]);
    expect(preview.resumen).toMatchObject({ total: 1, nuevas: 1, conError: 0 });
    const c = await conf("ventas", { syncId, payload, ediciones: {} });
    expect(c.json).toMatchObject({ importadas: 1 });
    const V = T.ventas.fields;
    const [row] = fake.rows(T.ventas.id);
    expect(row.fields).toMatchObject({
      [V.claveArca]: `1|3|77|${CUIT_CLIENTE}`,
      [V.tipoComprobante]: [tipoA],
      [V.cliente]: [ids.cliente],
      [V.netoGravIva0]: 10,
      [V.iva25]: 0.25,
      [V.netoGravIva25]: 10,
      [V.iva5]: 0.5,
      [V.netoGravIva5]: 10,
      [V.iva105]: 1.05,
      [V.netoGravIva105]: 10,
      [V.iva21]: 210,
      [V.netoGravIva21]: 1000,
      [V.iva27]: 2.7,
      [V.netoGravIva27]: 10,
      [V.netoGravadoTotal]: 1050,
      [V.totalIva]: 214.5,
      [V.impTotal]: 1264.5,
    });
  });
});
