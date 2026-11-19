import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { cuitSintetico } from "./arca-fixture";
import { createFakeAirtable } from "./fake-airtable";
import { pdfText } from "./pdf-text";
import { createFakeWsfe } from "./wsfe-fixture";

/**
 * Factura A electrónica de punta a punta (CC-F5-10): rutas + servicio + Airtable falso + Afip
 * SDK falso (fetch global, por método). Nunca se llama a Afip SDK real. Datos sintéticos.
 */
const SECRET = "a".repeat(44);
const fake = createFakeAirtable();
const wsfe = createFakeWsfe(() => fake.calls.length);
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
const estadoRoute = await import("@/app/api/admin/facturas/route");
const emitirRoute = await import("@/app/api/admin/facturas/emitir/route");
const verificarRoute = await import("@/app/api/admin/facturas/[id]/verificar/route");
const completarRoute = await import("@/app/api/admin/facturas/[id]/completar/route");
const pdfRoute = await import("@/app/api/admin/facturas/[id]/pdf/route");
const proformaPdfRoute = await import("@/app/api/admin/proforma/pdf/route");
const { FACTURA_MESSAGES, parseDatos } = await import("@/lib/factura/factura");
const { deleteHora } = await import("@/lib/horas/server/admin-service");
const { deleteComprobante } = await import("@/lib/ventas-compras/server/comprobantes");
const { updateMaestro, loadMaestro } = await import("@/lib/abm/server/maestros-service");

const T = TABLES;
const U = T.usuarios.fields;
const CL = T.clientes.fields;
const P = T.proyectos.fields;
const Hf = T.horas.fields;
const PA = T.parametros.fields;
const CE = T.comprobantesEmitidos;
const F = CE.fields;
const V = T.ventas.fields;

const CUIT_CLIENTE = cuitSintetico("30", 71234567);
const CUIT_EMPRESA = cuitSintetico("30", 70000000);
const TOKEN = "tok_test_afip_wsfe_123";
// PEM sintéticos (no son un certificado real): solo la forma.
const CERT_PEM = "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUcertificadoFalsoDePrueba0000\n-----END CERTIFICATE-----";
const KEY_PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANclaveFalsaDePruebaNoEsReal0000000000\n-----END PRIVATE KEY-----";
const b64 = (s: string) => Buffer.from(s).toString("base64");

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("clave-de-prueba", 4);
});

let ids: Record<string, string>;
let consoleLines: string[];
const responses: string[] = [];
const t = (hhmm: string) => Number(hhmm.slice(0, 2)) * 3600 + Number(hhmm.slice(3)) * 60;
const param = (concepto: string, valor: string) => fake.seed(T.parametros.id, { [PA.concepto]: concepto, [PA.valor]: valor });

beforeEach(() => {
  fake.reset();
  wsfe.reset();
  cookieJar.clear();
  clearUserCache();
  responses.length = 0;
  consoleLines = [];
  const capture = (...args: unknown[]) => void consoleLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-19T15:00:00Z") });
  vi.stubGlobal("fetch", wsfe.fetch);
  vi.stubEnv("AFIP_SDK_TOKEN", TOKEN);
  vi.stubEnv("AFIP_WSFE_ENV", "");
  const user = (email: string, rol: string) =>
    fake.seed(T.usuarios.id, { [U.nombre]: email, [U.email]: email, [U.rol]: rol, [U.sigla]: email.slice(0, 2).toUpperCase(), [U.estado]: "Activo", [U.debeCambiarPassword]: false, [U.passwordHash]: hash });
  const admin = user("ana@kairos.test", "Admin");
  const cliente = fake.seed(T.clientes.id, {
    [CL.nombre]: "QA Cliente RI",
    [CL.sigla]: "QR",
    [CL.estado]: "Activo",
    [CL.cuit]: CUIT_CLIENTE,
    [CL.condicionIva]: "Responsable Inscripto",
    [CL.razonSocial]: "QA Cliente RI S.A.",
    [CL.domicilioComercial]: "Calle QA 123, CABA",
  });
  const web = fake.seed(T.proyectos.id, { [P.codigo]: "QR - Web", [P.cliente]: [cliente], [P.valorHora]: 1234.57, [P.monedaValorHora]: "ARS", [P.estado]: "Activo" });
  const hora = (fecha: string, desde: string, hasta: string, extra: Record<string, unknown> = {}) =>
    fake.seed(T.horas.id, { [Hf.fecha]: fecha, [Hf.proyecto]: [web], [Hf.colaborador]: [admin], [Hf.tarea]: `Tarea ${fecha}`, [Hf.horaDesde]: t(desde), [Hf.horaHasta]: t(hasta), [Hf.facturable]: true, ...extra });
  ids = {
    admin,
    cliente,
    web,
    h1: hora("2026-10-05", "09:00", "10:30"),
    h2: hora("2026-10-06", "09:00", "09:20", { [Hf.estadoFacturacion]: "Pendiente" }),
    hFacturada: hora("2026-10-07", "09:00", "11:00", { [Hf.estadoFacturacion]: "Facturada" }),
    hNoFact: hora("2026-10-08", "09:00", "11:00", { [Hf.facturable]: false }),
    fa: fake.seed(T.tiposComprobante.id, { [T.tiposComprobante.fields.codigo]: 1, [T.tiposComprobante.fields.signo]: 1 }),
  };
  param("Alícuota IVA (proforma de horas)", "0.21");
  ids.pEmpresa = param("Empresa", "QA Empresa Emisora S.A.");
  ids.pCuit = param("CUIT", CUIT_EMPRESA);
  ids.pDomicilio = param("Domicilio comercial", "Av. QA 742, CABA");
  ids.pIibb = param("Ingresos Brutos", "901-000000-1");
  ids.pInicio = param("Inicio de actividades", "2020-03-01");
  ids.pPv = param("Punto de venta web services", "7");
  ids.pLeyenda = param("Leyenda factura A", "PAGO EN C.B.U. INFORMADA");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function login() {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId: ids.admin, pf: passwordFingerprint(hash) }, SECRET));
}

async function call(handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>, url: string, params: Record<string, string>, init: { method: string; body?: unknown; headers?: Record<string, string> }) {
  const cookie = cookieJar.get(SESSION_COOKIE);
  const req = new NextRequest(`http://localhost${url}`, {
    method: init.method,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}), ...init.headers },
  });
  const res = await handler(req, { params: Promise.resolve(params) });
  const buf = new Uint8Array(await res.arrayBuffer());
  const isPdf = res.headers.get("content-type") === "application/pdf";
  const text = isPdf ? "" : new TextDecoder().decode(buf);
  if (!isPdf) responses.push(text);
  return { status: res.status, json: text ? JSON.parse(text) : null, bytes: buf, headers: res.headers };
}

const estado = (cliente = ids.cliente, mes = "2026-10") => call(estadoRoute.GET as never, `/api/admin/facturas?cliente=${cliente}&mes=${mes}`, {}, { method: "GET" });
const emitirBody = (over: Record<string, unknown> = {}) => ({ cliente: ids.cliente, mes: "2026-10", vencimientoPago: "2026-12-19", detalle: "Servicios 10/2026: QR - Web", ...over });
const emitir = (b: unknown = emitirBody(), headers?: Record<string, string>) => call(emitirRoute.POST as never, "/api/admin/facturas/emitir", {}, { method: "POST", body: b, headers });
const verificar = (id: string) => call(verificarRoute.POST as never, `/api/admin/facturas/${id}/verificar`, { id }, { method: "POST", body: {} });
const completar = (id: string) => call(completarRoute.POST as never, `/api/admin/facturas/${id}/completar`, { id }, { method: "POST", body: {} });
const pdf = (id: string) => call(pdfRoute.GET as never, `/api/admin/facturas/${id}/pdf`, { id }, { method: "GET" });
const rows = () => fake.rows(CE.id);
const row = (id: string) => rows().find((r) => r.id === id)!;
const estadoHora = (id: string) => fake.rows(T.horas.id).find((r) => r.id === id)!.fields[Hf.estadoFacturacion];

// Importes esperados (centavos): h1 = 1,5 h × 1234,57 = 1851,855 → 1851,86; h2 = 20 min = 0,33 h (horas a 2
// decimales, recordHours) × 1234,57 = 407,4081 → 407,41. Neto 2259,27; IVA 21 % = 474,4467 → 474,45.
const NETO = 185186 + 40741;
const IVA = 47445;
const TOTAL = NETO + IVA;

function usarProduccion() {
  vi.stubEnv("AFIP_WSFE_ENV", "prod");
  vi.stubEnv("AFIP_CERT_B64", b64(CERT_PEM));
  vi.stubEnv("AFIP_KEY_B64", b64(KEY_PEM));
}

describe("elegibilidad (D1)", () => {
  beforeEach(login);

  it("todo en orden → elegible, Homologación, importes solo de horas Pendiente (sin la Facturada ni la no facturable)", async () => {
    const r = await estado();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ambiente: "Homologación", configurada: true, elegible: true, motivos: [], hoy: "2026-11-19", importes: { neto: NETO, iva: IVA, total: TOTAL }, difiere: true });
    expect(Number.isInteger(r.json.importes.neto) && Number.isInteger(r.json.importes.iva)).toBe(true);
    expect(r.json.detalleSugerido).toBe("Servicios 10/2026: QR - Web");
    expect(r.json.proformaTotales).toEqual([expect.objectContaining({ moneda: "ARS", subtotal: NETO + 246914 })]); // + la Facturada (2 h)
  });

  const casos: [string, () => void, string][] = [
    ["USD en la proforma", () => {
      const usd = fake.seed(T.proyectos.id, { [P.codigo]: "QR - USD", [P.cliente]: [ids.cliente], [P.valorHora]: 50, [P.monedaValorHora]: "USD", [P.estado]: "Activo" });
      fake.seed(T.horas.id, { [Hf.fecha]: "2026-10-09", [Hf.proyecto]: [usd], [Hf.tarea]: "x", [Hf.horaDesde]: t("09:00"), [Hf.horaHasta]: t("10:00"), [Hf.facturable]: true, [Hf.estadoFacturacion]: "Facturada" });
    }, FACTURA_MESSAGES.soloPesos],
    ["proyecto sin valor hora", () => {
      const sin = fake.seed(T.proyectos.id, { [P.codigo]: "QR - Sin", [P.cliente]: [ids.cliente], [P.estado]: "Activo" });
      fake.seed(T.horas.id, { [Hf.fecha]: "2026-10-09", [Hf.proyecto]: [sin], [Hf.tarea]: "x", [Hf.horaDesde]: t("09:00"), [Hf.horaHasta]: t("10:00"), [Hf.facturable]: true, [Hf.estadoFacturacion]: "Pagada" });
    }, FACTURA_MESSAGES.incompleta],
    ["cliente Monotributista", () => void (fake.rows(T.clientes.id)[0].fields[CL.condicionIva] = "Monotributista"), FACTURA_MESSAGES.noResponsableInscripto],
    ["CUIT del cliente inválida", () => void (fake.rows(T.clientes.id)[0].fields[CL.cuit] = "30111111110"), FACTURA_MESSAGES.cuitCliente],
    ["sin razón social", () => void delete fake.rows(T.clientes.id)[0].fields[CL.razonSocial], FACTURA_MESSAGES.razonSocialCliente],
    ["sin domicilio comercial del cliente", () => void (fake.rows(T.clientes.id)[0].fields[CL.domicilioComercial] = "  "), FACTURA_MESSAGES.domicilioCliente],
    ...(["Empresa", "CUIT", "Domicilio comercial", "Ingresos Brutos", "Inicio de actividades", "Punto de venta web services"] as const).map(
      (c): [string, () => void, string] => [`parámetro ${c} vacío`, () => void (fake.rows(T.parametros.id).find((r) => r.fields[PA.concepto] === c)!.fields[PA.valor] = ""), FACTURA_MESSAGES.parametroFalta(c)],
    ),
    ["CUIT de la empresa inválida", () => void (fake.rows(T.parametros.id).find((r) => r.id === ids.pCuit)!.fields[PA.valor] = "30111111110"), FACTURA_MESSAGES.parametroInvalido("CUIT", "CUIT de 11 dígitos")],
    ["inicio de actividades mal formado", () => void (fake.rows(T.parametros.id).find((r) => r.id === ids.pInicio)!.fields[PA.valor] = "01/03/2020"), FACTURA_MESSAGES.parametroInvalido("Inicio de actividades", "AAAA-MM-DD")],
    ["punto de venta 0", () => void (fake.rows(T.parametros.id).find((r) => r.id === ids.pPv)!.fields[PA.valor] = "0"), FACTURA_MESSAGES.parametroInvalido("Punto de venta web services", "entero de 1 a 99999")],
    ["punto de venta 100000", () => void (fake.rows(T.parametros.id).find((r) => r.id === ids.pPv)!.fields[PA.valor] = "100000"), FACTURA_MESSAGES.parametroInvalido("Punto de venta web services", "entero de 1 a 99999")],
    ["alícuota 22 %", () => void (fake.rows(T.parametros.id).find((r) => r.fields[PA.concepto] === "Alícuota IVA (proforma de horas)")!.fields[PA.valor] = "22%"), FACTURA_MESSAGES.alicuota],
    ["ninguna hora Pendiente", () => {
      for (const r of fake.rows(T.horas.id)) r.fields[Hf.estadoFacturacion] = "Facturada";
    }, FACTURA_MESSAGES.sinPendientes("10/2026")],
    ["ya hay una factura Autorizada del mismo cliente + mes + ambiente", () => {
      fake.seed(CE.id, { [F.tipo]: "Factura A", [F.ambiente]: "Homologación", [F.estado]: "Autorizada", [F.cliente]: [ids.cliente], [F.mes]: "2026-10-01" });
    }, FACTURA_MESSAGES.yaEmitida("Homologación", "Autorizada")],
    ["una Incierta también bloquea", () => {
      fake.seed(CE.id, { [F.tipo]: "Factura A", [F.ambiente]: "Homologación", [F.estado]: "Incierta", [F.cliente]: [ids.cliente], [F.mes]: "2026-10-01" });
    }, FACTURA_MESSAGES.yaEmitida("Homologación", "Incierta")],
    ["sin AFIP_SDK_TOKEN", () => vi.stubEnv("AFIP_SDK_TOKEN", ""), FACTURA_MESSAGES.noConfigurada],
  ];
  it.each(casos)("%s → no elegible, con su motivo (y solo ese)", async (_l, mutar, motivo) => {
    mutar();
    const r = await estado();
    expect(r.status).toBe(200);
    expect(r.json.elegible).toBe(false);
    expect(r.json.motivos).toEqual([motivo]);
    // El servidor rechaza la emisión igual (409 o 503) y nunca habla con WSFE.
    const e = await emitir();
    expect([409, 503]).toContain(e.status);
    expect(wsfe.requests).toHaveLength(0);
  });

  it("una Rechazada o una de otro ambiente no bloquea", async () => {
    fake.seed(CE.id, { [F.tipo]: "Factura A", [F.ambiente]: "Homologación", [F.estado]: "Rechazada", [F.cliente]: [ids.cliente], [F.mes]: "2026-10-01" });
    fake.seed(CE.id, { [F.tipo]: "Factura A", [F.ambiente]: "Producción", [F.estado]: "Autorizada", [F.cliente]: [ids.cliente], [F.mes]: "2026-10-01" });
    expect((await estado()).json.elegible).toBe(true);
  });

  it("una proforma en USD se sigue descargando (la proforma no cambia)", async () => {
    const usd = fake.seed(T.proyectos.id, { [P.codigo]: "QR - USD", [P.cliente]: [ids.cliente], [P.valorHora]: 50, [P.monedaValorHora]: "USD", [P.estado]: "Activo" });
    fake.seed(T.horas.id, { [Hf.fecha]: "2026-10-09", [Hf.proyecto]: [usd], [Hf.tarea]: "x", [Hf.horaDesde]: t("09:00"), [Hf.horaHasta]: t("10:00"), [Hf.facturable]: true });
    const r = await call(proformaPdfRoute.GET as never, `/api/admin/proforma/pdf?cliente=${ids.cliente}&mes=2026-10`, {}, { method: "GET" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect((await estado()).json.motivos).toEqual([FACTURA_MESSAGES.soloPesos]);
  });
});

describe("emisión en Homologación (D7)", () => {
  beforeEach(login);

  it("Autorizada: «En proceso» antes de WSFE, número = último + 1, un solo FECAESolicitar con importes enteros y consistentes", async () => {
    wsfe.setUltimo(41);
    const r = await emitir();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, estado: "Autorizada" });
    const created = fake.calls.findIndex((c) => c.method === "create" && c.tableId === CE.id);
    expect(created).toBeGreaterThanOrEqual(0);
    expect(wsfe.requests.every((q) => q.seq > created)).toBe(true);
    expect((fake.calls[created].payload as Record<string, unknown>[])[0][F.estado]).toBe("En proceso");

    const cae = wsfe.calls("FECAESolicitar");
    expect(cae).toHaveLength(1);
    const det = (cae[0].body.params as any).FeCAEReq.FeDetReq.FECAEDetRequest; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(cae[0].body).toMatchObject({ environment: "dev", wsid: "wsfe", method: "FECAESolicitar" });
    expect((cae[0].body.params as any).Auth).toEqual({ Token: "TA-token-fake", Sign: "TA-sign-fake", Cuit: "20409378472" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((cae[0].body.params as any).FeCAEReq.FeCabReq).toEqual({ CantReg: 1, PtoVta: 1, CbteTipo: 1 }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(det).toMatchObject({
      Concepto: 2, DocTipo: 80, DocNro: Number(CUIT_CLIENTE), CbteDesde: 42, CbteHasta: 42, CbteFch: 20261119,
      FchServDesde: 20261001, FchServHasta: 20261031, FchVtoPago: 20261219, ImpTotConc: 0, ImpOpEx: 0, ImpTrib: 0,
      MonId: "PES", MonCotiz: 1, CondicionIVAReceptorId: 1,
      ImpNeto: NETO / 100, ImpIVA: IVA / 100, ImpTotal: TOTAL / 100,
      Iva: { AlicIva: [{ Id: 5, BaseImp: NETO / 100, Importe: IVA / 100 }] },
    });
    expect(Math.round(det.ImpTotal * 100)).toBe(Math.round(det.ImpNeto * 100) + Math.round(det.ImpIVA * 100));

    const [rec] = rows();
    expect(rec.fields).toMatchObject({ [F.estado]: "Autorizada", [F.ambiente]: "Homologación", [F.tipo]: "Factura A", [F.numero]: 42, [F.puntoVenta]: 1, [F.cae]: "70000000000001", [F.vencimientoCae]: "2026-11-29", [F.fechaEmision]: "2026-11-19", [F.vencimientoPago]: "2026-12-19", [F.mes]: "2026-10-01", [F.cliente]: [ids.cliente], [F.usuario]: [ids.admin] });
    expect(rec.fields[F.comprobante]).toBe("FA 00001-00000042 · QA Cliente RI · 10/2026 · Homologación");
    const datos = parseDatos(rec.fields[F.datos])!;
    expect(datos).toMatchObject({ ambiente: "Homologación", numero: 42, cae: "70000000000001", horas: [ids.h1, ids.h2], importes: { neto: NETO, iva: IVA, total: TOTAL } });
    expect(datos.emisor).toMatchObject({ cuit: "20409378472", razonSocial: "QA Empresa Emisora S.A.", leyenda: "PAGO EN C.B.U. INFORMADA" });
  });

  it("Homologación nunca escribe Ventas ni cambia Horas, y no linkea horas", async () => {
    await emitir();
    expect(fake.calls.filter((c) => c.tableId === T.ventas.id && c.method !== "list")).toHaveLength(0);
    expect(fake.calls.filter((c) => c.tableId === T.horas.id && c.method !== "list")).toHaveLength(0);
    expect(estadoHora(ids.h1)).toBeUndefined();
    expect(rows()[0].fields[F.horas]).toBeUndefined();
    expect(rows()[0].fields[F.venta]).toBeUndefined();
  });

  it("body estricto, Origin, vencimiento ≥ hoy, detalle ≤ 200", async () => {
    expect((await emitir({ ...emitirBody(), total: 1 })).status).toBe(400);
    expect((await emitir(emitirBody({ vencimientoPago: "2026-11-18" }))).json.error).toBe(FACTURA_MESSAGES.vencimientoPago);
    expect((await emitir(emitirBody({ detalle: "x".repeat(201) }))).json.error).toBe(FACTURA_MESSAGES.detalle);
    expect((await emitir(emitirBody({ detalle: "  " }))).json.error).toBe(FACTURA_MESSAGES.detalle);
    expect((await emitir(emitirBody(), { origin: "https://evil.test" })).status).toBe(403);
    expect(wsfe.requests).toHaveLength(0);
    expect(rows()).toHaveLength(0);
    const ok = await emitir(emitirBody({ vencimientoPago: "2026-11-19" }));
    expect(ok.json.estado).toBe("Autorizada");
  });

  it("carrera: dos emisiones a la vez → una sola llamada a FECAESolicitar; la perdedora se borra con 409", async () => {
    fake.barrier("create", CE.id, 2);
    const [a, b] = await Promise.all([emitir(), emitir()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((x) => x.status === 409)!.json.error).toBe(FACTURA_MESSAGES.enParalelo);
    expect(wsfe.calls("FECAESolicitar")).toHaveLength(1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].fields[F.estado]).toBe("Autorizada");
  });

  it("la perdedora que no se puede borrar queda Rechazada (no ocupa la clave)", async () => {
    fake.barrier("create", CE.id, 2);
    fake.failWhen((c) => c.method === "delete" && c.tableId === CE.id);
    const [a, b] = await Promise.all([emitir(), emitir()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(wsfe.calls("FECAESolicitar")).toHaveLength(1);
    expect(rows().map((r) => r.fields[F.estado]).sort()).toEqual(["Autorizada", "Rechazada"]);
  });

  it.each([
    ["timeout / red", "network" as const],
    ["500", { status: 500, body: {} }],
    ["503", { status: 503, body: {} }],
    ["429", { status: 429, body: {} }],
    ["respuesta ilegible", { status: 200, raw: "<html>no es json" }],
    ["200 sin Resultado", { status: 200, body: { FECAESolicitarResult: { FeCabResp: {} } } }],
  ])("FECAESolicitar con %s → Incierta, un solo intento", async (_l, falla) => {
    wsfe.on("FECAESolicitar", falla);
    const r = await emitir();
    expect(r.json).toMatchObject({ estado: "Incierta", mensaje: FACTURA_MESSAGES.incierta });
    expect(wsfe.calls("FECAESolicitar")).toHaveLength(1);
    expect(rows()[0].fields).toMatchObject({ [F.estado]: "Incierta", [F.mensaje]: FACTURA_MESSAGES.incierta, [F.numero]: 1 });
    // Una Incierta bloquea otra emisión hasta verificar.
    expect((await emitir()).status).toBe(409);
    expect(wsfe.calls("FECAESolicitar")).toHaveLength(1);
  });

  it("Resultado R → Rechazada con «Code: Msg», sin controles, ≤ 300 caracteres y ≤ 10 líneas; libera la clave", async () => {
    const errs = Array.from({ length: 12 }, (_, i) => ({ Code: 10000 + i, Msg: i === 0 ? `El número\u0007 no corresponde ${"x".repeat(400)}` : `Error ${i}` }));
    wsfe.on("FECAESolicitar", { body: { FECAESolicitarResult: { FeCabResp: { Resultado: "R" }, FeDetResp: { FECAEDetResponse: { Resultado: "R", Observaciones: { Obs: { Code: 10016, Msg: "Obs" } } } }, Errors: { Err: errs } } } });
    const r = await emitir();
    expect(r.json.estado).toBe("Rechazada");
    const lines = String(rows()[0].fields[F.mensaje]).split("\n");
    expect(lines).toHaveLength(10);
    expect(lines[0]).toMatch(/^10000: El número no corresponde x+…$/);
    expect(lines[0].length).toBe(300);
    expect(lines.join("")).not.toMatch(/[\u0000-\u001f]/);
    expect(r.json.mensaje).toBe(lines.join("\n"));
    expect((await estado()).json.elegible).toBe(true);
  });

  it("falla antes de pedir el CAE (auth o último número) → Rechazada, nunca FECAESolicitar", async () => {
    wsfe.on("FECompUltimoAutorizado", { status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} });
    const r = await emitir();
    expect(r.json.estado).toBe("Rechazada");
    expect(wsfe.calls("FECompUltimoAutorizado")).toHaveLength(4); // lectura: 1 + 3 reintentos
    expect(wsfe.calls("FECAESolicitar")).toHaveLength(0);
  }, 30_000);
});

describe("Verificar en ARCA (D7d)", () => {
  beforeEach(login);

  async function incierta() {
    wsfe.on("FECAESolicitar", "network");
    const r = await emitir();
    expect(r.json.estado).toBe("Incierta");
    return r.json.id as string;
  }

  it("ARCA la tiene y coincide → Autorizada con el CAE; nunca pide otro CAE", async () => {
    const id = await incierta();
    wsfe.autorizarAMano(1, 1, { docNro: Number(CUIT_CLIENTE), impTotal: TOTAL / 100, cbteFch: 20261119 });
    const r = await verificar(id);
    expect(r.json).toMatchObject({ estado: "Autorizada" });
    expect(row(id).fields).toMatchObject({ [F.estado]: "Autorizada", [F.cae]: "70000000000001", [F.vencimientoCae]: "2026-11-29" });
    expect(wsfe.calls("FECAESolicitar")).toHaveLength(1);
    expect(wsfe.calls("FECompConsultar")).toHaveLength(1);
  });

  it("último < número → Rechazada «ARCA no emitió la factura»; se puede volver a emitir", async () => {
    const id = await incierta();
    wsfe.setUltimo(0);
    const r = await verificar(id);
    expect(r.json).toMatchObject({ estado: "Rechazada", mensaje: FACTURA_MESSAGES.noEmitida });
    expect(wsfe.calls("FECompConsultar")).toHaveLength(0);
    expect((await estado()).json.elegible).toBe(true);
  });

  it("no coincide (otro total, otro receptor u otra fecha) → sigue Incierta «Revisar manualmente»", async () => {
    for (const d of [{ docNro: Number(CUIT_CLIENTE), impTotal: 1, cbteFch: 20261119 }, { docNro: 30000000007, impTotal: TOTAL / 100, cbteFch: 20261119 }, { docNro: Number(CUIT_CLIENTE), impTotal: TOTAL / 100, cbteFch: 20261118 }]) {
      wsfe.reset();
      const seedRow = fake.seed(CE.id, {
        [F.tipo]: "Factura A", [F.ambiente]: "Homologación", [F.estado]: "Incierta", [F.cliente]: [ids.cliente], [F.mes]: "2026-10-01", [F.numero]: 5, [F.puntoVenta]: 1,
        [F.datos]: JSON.stringify({ version: 1, ambiente: "Homologación", tipo: "Factura A", cbteTipo: 1, emisor: { cuit: "20409378472" }, receptor: { cuit: CUIT_CLIENTE }, importes: { neto: NETO, iva: IVA, total: TOTAL }, detalle: {}, puntoVenta: 1, horas: [], fechaEmision: "2026-11-19" }),
      });
      wsfe.autorizarAMano(1, 5, d);
      const r = await verificar(seedRow);
      expect(r.json).toMatchObject({ estado: "Incierta", mensaje: FACTURA_MESSAGES.revisarManual });
    }
  });

  it("solo Incierta (o «En proceso» colgado): Autorizada → 409", async () => {
    const r = await emitir();
    expect((await verificar(r.json.id)).status).toBe(409);
    const colgado = fake.seed(CE.id, { [F.tipo]: "Factura A", [F.ambiente]: "Homologación", [F.estado]: "En proceso", [F.cliente]: [ids.cliente], [F.mes]: "2026-09-01", [F.iniciado]: "2026-11-19T14:00:00.000Z", [F.datos]: rows()[0].fields[F.datos] });
    expect((await verificar(colgado)).status).toBe(200);
  });
});

describe("Producción (D2, D7e)", () => {
  beforeEach(async () => {
    await login();
    usarProduccion();
  });

  it("Autorizada → Venta con el formato de una fila sincronizada y horas Facturada, todo linkeado", async () => {
    wsfe.setUltimo(9);
    const r = await emitir();
    expect(r.json).toMatchObject({ estado: "Autorizada", mensaje: null });
    const auth = wsfe.requests.find((q) => q.path.endsWith("/afip/auth"))!;
    expect(auth.body).toEqual({ environment: "prod", tax_id: CUIT_EMPRESA, wsid: "wsfe", cert: CERT_PEM, key: KEY_PEM });
    expect((wsfe.calls("FECAESolicitar")[0].body.params as any).FeCAEReq.FeCabReq.PtoVta).toBe(7); // eslint-disable-line @typescript-eslint/no-explicit-any
    const [venta] = fake.rows(T.ventas.id);
    expect(venta.fields).toMatchObject({
      [V.claveArca]: `1|7|10|${CUIT_CLIENTE}`, [V.tipo]: "1 - Factura A", [V.tipoComprobante]: [ids.fa], [V.puntoVenta]: 7, [V.numeroDesde]: 10, [V.numeroHasta]: 10,
      [V.codAutorizacion]: "70000000000001", [V.tipoDocReceptor]: "CUIT", [V.nroDocReceptor]: CUIT_CLIENTE, [V.denominacionReceptor]: "QA Cliente RI S.A.",
      [V.tipoCambio]: 1, [V.moneda]: "$", [V.netoGravIva21]: NETO / 100, [V.iva21]: IVA / 100, [V.netoGravadoTotal]: NETO / 100, [V.totalIva]: IVA / 100, [V.impTotal]: TOTAL / 100,
      [V.netoNoGravado]: 0, [V.opExentas]: 0, [V.otrosTributos]: 0, [V.mesDevengado]: "2026-10-01", [V.cliente]: [ids.cliente], [V.proyecto]: [ids.web], [V.fecha]: "2026-11-19",
    });
    expect(estadoHora(ids.h1)).toBe("Facturada");
    expect(estadoHora(ids.h2)).toBe("Facturada");
    expect(estadoHora(ids.hFacturada)).toBe("Facturada");
    expect(rows()[0].fields).toMatchObject({ [F.ambiente]: "Producción", [F.venta]: [venta.id], [F.horas]: [ids.h1, ids.h2] });
    expect(rows()[0].fields[F.mensaje]).toBeUndefined();
    expect(rows()[0].fields[F.comprobante]).toBe("FA 00007-00000010 · QA Cliente RI · 10/2026 · Producción");
  });

  it("falla al crear la Venta → Autorizada con «falta registrar»; «Completar registro» crea lo que falta una sola vez", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "factura:ventas:0");
    const r = await emitir();
    expect(r.json).toMatchObject({ estado: "Autorizada", mensaje: FACTURA_MESSAGES.faltaRegistro });
    expect(fake.rows(T.ventas.id)).toHaveLength(0);
    expect(estadoHora(ids.h1)).toBeUndefined();
    const id = r.json.id as string;
    expect((await estado()).json.comprobantes[0]).toMatchObject({ estado: "Autorizada", completable: true, pdf: true });
    vi.stubEnv("KAIROS_FAULT_INJECTION", "");
    expect((await completar(id)).json).toMatchObject({ estado: "Autorizada" });
    expect(fake.rows(T.ventas.id)).toHaveLength(1);
    expect(estadoHora(ids.h1)).toBe("Facturada");
    expect((await completar(id)).status).toBe(409);
    expect(fake.rows(T.ventas.id)).toHaveLength(1);
    expect(wsfe.calls("FECAESolicitar")).toHaveLength(1);
  });

  it("falla al marcar las horas → se restauran, la Venta queda; «Completar registro» reusa la Venta (sin duplicar)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "factura:horas:0");
    const r = await emitir();
    expect(r.json.mensaje).toBe(FACTURA_MESSAGES.faltaRegistro);
    expect(fake.rows(T.ventas.id)).toHaveLength(1);
    expect(estadoHora(ids.h1)).toBeUndefined();
    vi.stubEnv("KAIROS_FAULT_INJECTION", "");
    await completar(r.json.id);
    expect(fake.rows(T.ventas.id)).toHaveLength(1);
    expect(estadoHora(ids.h1)).toBe("Facturada");
    expect(rows()[0].fields[F.venta]).toEqual([fake.rows(T.ventas.id)[0].id]);
  });

  it("una hora facturada no se borra; la Venta de una factura emitida tampoco", async () => {
    await emitir();
    // El inverso lo mantiene Airtable: acá se simula.
    fake.rows(T.horas.id).find((h) => h.id === ids.h1)!.fields[Hf.comprobantesEmitidos] = [rows()[0].id];
    const venta = fake.rows(T.ventas.id)[0];
    venta.fields[V.comprobantesEmitidos] = [rows()[0].id];
    expect(await deleteHora(ids.h1)).toMatchObject({ ok: false, status: 409 });
    expect(await deleteComprobante("ventas", venta.id)).toMatchObject({ ok: false, status: 409 });
    expect(await deleteHora(ids.hNoFact)).toMatchObject({ ok: true });
  });

  it("prod sin certificado o con uno inválido → no configurada (503), nunca cae a dev ni llama a Afip SDK", async () => {
    for (const [cert, key] of [["", b64(KEY_PEM)], [b64(CERT_PEM), ""], ["no-es-base64!!", b64(KEY_PEM)], [b64("hola"), b64(KEY_PEM)], [b64(KEY_PEM), b64(CERT_PEM)]]) {
      vi.stubEnv("AFIP_CERT_B64", cert);
      vi.stubEnv("AFIP_KEY_B64", key);
      const r = await emitir();
      expect(r).toMatchObject({ status: 503, json: { error: FACTURA_MESSAGES.prodSinCertificado } });
      const s = await estado();
      expect(s.json).toMatchObject({ ambiente: "Producción", configurada: false, elegible: false });
      expect(s.json.motivos).toContain(FACTURA_MESSAGES.prodSinCertificado);
    }
    expect(wsfe.requests).toHaveLength(0);
  });
});

describe("entorno y secretos (D2)", () => {
  beforeEach(login);

  it("AFIP_WSFE_ENV vacío, «dev» o cualquier otra cosa («PROD», «production») = Homologación", async () => {
    for (const v of ["", "dev", "PROD", "production", " prod2"]) {
      vi.stubEnv("AFIP_WSFE_ENV", v);
      expect((await estado()).json.ambiente).toBe("Homologación");
    }
  });

  it("token, certificado y clave nunca en logs ni en respuestas", async () => {
    usarProduccion();
    wsfe.on("FECAESolicitar", { status: 500, body: { message: "boom" } });
    await emitir();
    vi.stubEnv("AFIP_WSFE_ENV", "");
    await emitir(emitirBody({ mes: "2026-10" }));
    const all = [...consoleLines, ...responses].join("\n");
    for (const secret of [TOKEN, CERT_PEM, KEY_PEM, b64(CERT_PEM), b64(KEY_PEM), "TA-token-fake", "TA-sign-fake", "MIIEvQIBADAN"]) expect(all).not.toContain(secret);
  });

  it("check:bundle verifica los nombres nuevos; .env.example y README los documentan", () => {
    const script = readFileSync("scripts/check-bundle.mjs", "utf8");
    for (const n of ["AFIP_WSFE_ENV", "AFIP_CERT_B64", "AFIP_KEY_B64"]) {
      expect(script).toContain(`"${n}"`);
      expect(readFileSync(".env.example", "utf8")).toMatch(new RegExp(`^${n}=$`, "m"));
      expect(readFileSync("README.md", "utf8")).toContain(`\`${n}\``);
    }
  });
});

describe("PDF de la factura (D9)", () => {
  beforeEach(login);

  it("Autorizada → PDF «Factura_A_00001-00000001.pdf» con tres copias y marca de Homologación", async () => {
    const r = await emitir();
    const res = await pdf(r.json.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('filename="Factura_A_00001-00000001.pdf"');
    const { pages, numPages } = await pdfText(res.bytes);
    expect(numPages).toBe(3);
    ["ORIGINAL", "DUPLICADO", "TRIPLICADO"].forEach((c, i) => expect(pages[i].join(" ")).toContain(c));
    expect(pages[0].join(" ")).toContain("HOMOLOGACIÓN · SIN VALIDEZ FISCAL");
  });

  it("sin CAE (Rechazada/Incierta) → 409", async () => {
    wsfe.on("FECAESolicitar", "network");
    const r = await emitir();
    expect((await pdf(r.json.id)).status).toBe(409);
  });

  it("el PDF sale del snapshot: cambiar el cliente o los Parámetros después no lo cambia", async () => {
    const r = await emitir();
    fake.rows(T.clientes.id)[0].fields[CL.razonSocial] = "Otra Razón S.A.";
    fake.rows(T.parametros.id).find((x) => x.id === ids.pEmpresa)!.fields[PA.valor] = "Otra Empresa";
    const text = (await pdfText((await pdf(r.json.id)).bytes)).pages[0].join(" ");
    expect(text).toContain("QA Cliente RI S.A.");
    expect(text).toContain("QA Empresa Emisora S.A.");
    expect(text).not.toContain("Otra");
  });
});

describe("datos maestros (D6)", () => {
  it("el ABM de Clientes edita Razón social y Domicilio comercial", async () => {
    const res = await updateMaestro("clientes", ids.cliente, {
      nombre: "QA Cliente RI", estado: "Activo", sigla: "QR", cuit: CUIT_CLIENTE, condicionIva: "Responsable Inscripto", razonSocial: "QA Nueva Razón S.R.L.", domicilioComercial: "Nueva 1", contacto: "", telefono: "", mail: "", observaciones: "",
    });
    expect(res.ok).toBe(true);
    expect(fake.rows(T.clientes.id)[0].fields).toMatchObject({ [CL.razonSocial]: "QA Nueva Razón S.R.L.", [CL.domicilioComercial]: "Nueva 1" });
    const data = await loadMaestro("clientes");
    expect(JSON.stringify(data)).toContain("QA Nueva Razón S.R.L.");
  });

  it("los Conceptos nuevos de Parámetros no se renombran (el nombre es de solo lectura)", async () => {
    const res = await updateMaestro("parametros", ids.pLeyenda, { concepto: "Otro nombre", valor: "PAGO EN C.B.U. INFORMADA", descripcion: "" });
    expect(res.ok).toBe(true);
    expect(fake.rows(T.parametros.id).find((r) => r.id === ids.pLeyenda)!.fields[PA.concepto]).toBe("Leyenda factura A");
  });
});

describe("CC-F5-11 · autorización completa, PDF del snapshot, PEM y Observaciones", () => {
  beforeEach(login);
  const aprobada = (det: Record<string, unknown>) => ({
    body: { FECAESolicitarResult: { FeCabResp: { Resultado: "A" }, FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CAE: "70000000000099", CAEFchVto: "20261129", ...det }] } } },
  });

  it.each([
    ["sin CAEFchVto", { CAEFchVto: undefined }],
    ["CAEFchVto inválido", { CAEFchVto: "20261340" }],
    ["CAEFchVto vacío", { CAEFchVto: "" }],
    ["CAE de 13 dígitos", { CAE: "7000000000009" }],
    ["sin CAE", { CAE: undefined }],
  ])("Resultado A %s → Incierta (nunca Autorizada), un solo FECAESolicitar", async (_l, det) => {
    wsfe.on("FECAESolicitar", aprobada(det));
    const r = await emitir();
    expect(r.json).toMatchObject({ estado: "Incierta", mensaje: FACTURA_MESSAGES.incierta });
    expect(rows()[0].fields[F.estado]).toBe("Incierta");
    expect(rows()[0].fields[F.cae]).toBeUndefined();
    expect(wsfe.calls("FECAESolicitar")).toHaveLength(1);
    expect((await pdf(r.json.id)).status).toBe(409);
  });

  describe("verificar exige una autorización completa en FECompConsultar", () => {
    async function incierta() {
      wsfe.on("FECAESolicitar", "network");
      const r = await emitir();
      wsfe.setUltimo(1);
      return r.json.id as string;
    }
    const consulta = (over: Record<string, unknown>) => ({
      body: { FECompConsultarResult: { ResultGet: { DocTipo: 80, DocNro: Number(CUIT_CLIENTE), CbteDesde: 1, CbteHasta: 1, CbteFch: "20261119", ImpTotal: TOTAL / 100, CodAutorizacion: "70000000000077", FchVto: "20261129", Resultado: "A", EmisionTipo: "CAE", ...over } } },
    });
    it.each([
      ["Resultado R", { Resultado: "R" }],
      ["sin Resultado", { Resultado: undefined }],
      ["sin FchVto", { FchVto: undefined }],
      ["FchVto inválida", { FchVto: "2026113" }],
      ["CAE inválido", { CodAutorizacion: "123" }],
      ["sin CAE", { CodAutorizacion: undefined }],
    ])("%s → sigue Incierta «Revisar manualmente»", async (_l, over) => {
      const id = await incierta();
      wsfe.on("FECompConsultar", consulta(over));
      const r = await verificar(id);
      expect(r.json).toMatchObject({ estado: "Incierta", mensaje: FACTURA_MESSAGES.revisarManual });
      expect(row(id).fields[F.cae]).toBeUndefined();
      expect(wsfe.calls("FECAESolicitar")).toHaveLength(1);
    });
    it("completa y coincidente → Autorizada, con número, CAE y vencimiento también en el snapshot", async () => {
      const id = await incierta();
      wsfe.on("FECompConsultar", consulta({}));
      expect((await verificar(id)).json.estado).toBe("Autorizada");
      expect(row(id).fields).toMatchObject({ [F.cae]: "70000000000077", [F.vencimientoCae]: "2026-11-29", [F.numero]: 1 });
      expect(parseDatos(row(id).fields[F.datos])).toMatchObject({ numero: 1, cae: "70000000000077", vencimientoCae: "2026-11-29" });
      // Un solo update hace las dos cosas.
      const upd = fake.calls.filter((c) => c.method === "update" && c.tableId === CE.id).map((c) => (c.payload as { fields: Record<string, unknown> }[])[0].fields);
      const final = upd.find((f) => f[F.estado] === "Autorizada")!;
      expect(final[F.cae]).toBe("70000000000077");
      expect(parseDatos(final[F.datos])).toMatchObject({ cae: "70000000000077", vencimientoCae: "2026-11-29", numero: 1 });
    });
    it("con otro Ambiente → 409 (no llama a ARCA)", async () => {
      const id = await incierta();
      const antes = wsfe.requests.length;
      usarProduccion();
      const r = await verificar(id);
      expect(r).toMatchObject({ status: 409, json: { error: "Esta factura es de Homologación; la app está en Producción." } });
      expect(wsfe.requests).toHaveLength(antes);
      expect(row(id).fields[F.estado]).toBe("Incierta");
    });
  });

  it("emitir: Autorizada escribe número, CAE y vencimiento en Datos en el mismo update que la fila", async () => {
    const r = await emitir();
    const upd = fake.calls.filter((c) => c.method === "update" && c.tableId === CE.id).map((c) => (c.payload as { fields: Record<string, unknown> }[])[0].fields);
    const final = upd.find((f) => f[F.estado] === "Autorizada")!;
    expect(parseDatos(final[F.datos])).toMatchObject({ numero: 1, cae: final[F.cae], vencimientoCae: final[F.vencimientoCae] });
    expect(r.json.estado).toBe("Autorizada");
  });

  it("el PDF sale solo de Datos: cambiar Número/CAE/Vencimiento CAE de la fila no lo cambia; sin CAE en Datos → 409", async () => {
    const r = await emitir();
    const rec = row(r.json.id);
    rec.fields[F.numero] = 999;
    rec.fields[F.cae] = "11111111111111";
    rec.fields[F.vencimientoCae] = "2030-01-01";
    const res = await pdf(r.json.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("Factura_A_00001-00000001.pdf");
    const t = (await pdfText(res.bytes)).pages[0].join(" ");
    expect(t).toContain("00000001");
    expect(t).toContain("70000000000001");
    expect(t).toContain("29/11/2026");
    expect(t).not.toContain("11111111111111");
    expect(t).not.toContain("00000999");
    for (const quitar of ["cae", "vencimientoCae", "numero"] as const) {
      const d = { ...parseDatos(rec.fields[F.datos])!, [quitar]: null };
      const sin = fake.seed(CE.id, { ...rec.fields, [F.datos]: JSON.stringify(d), [F.cae]: "70000000000001", [F.numero]: 1, [F.vencimientoCae]: "2026-11-29" });
      expect((await pdf(sin)).status).toBe(409);
    }
  });

  it("PEM: clave con rótulos distintos o certificado que no es CERTIFICATE → no configurada (503), sin logs del valor", async () => {
    usarProduccion();
    const mal = (begin: string, end: string) => b64(`-----BEGIN ${begin}-----\nMIIEvQIBADANclaveFalsa\n-----END ${end}-----`);
    for (const [cert, key] of [
      [b64(CERT_PEM), mal("RSA PRIVATE KEY", "PRIVATE KEY")],
      [b64(CERT_PEM), mal("EC PRIVATE KEY", "RSA PRIVATE KEY")],
      [b64(CERT_PEM), mal("ENCRYPTED PRIVATE KEY", "ENCRYPTED PRIVATE KEY")],
      [mal("CERTIFICATE REQUEST", "CERTIFICATE REQUEST"), b64(KEY_PEM)],
      [mal("TRUSTED CERTIFICATE", "TRUSTED CERTIFICATE"), b64(KEY_PEM)],
    ]) {
      vi.stubEnv("AFIP_CERT_B64", cert);
      vi.stubEnv("AFIP_KEY_B64", key);
      expect(await emitir()).toMatchObject({ status: 503, json: { error: FACTURA_MESSAGES.prodSinCertificado } });
    }
    expect(wsfe.requests).toHaveLength(0);
    expect([...consoleLines, ...responses].join("\n")).not.toContain("MIIEvQIBADANclaveFalsa");
  });

  describe("Producción: Observaciones en Mensaje y registro pendiente derivado de los datos", () => {
    beforeEach(usarProduccion);
    const conObs = () => ({
      body: { FECAESolicitarResult: { FeCabResp: { Resultado: "A" }, FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CAE: "70000000000055", CAEFchVto: "20261129", Observaciones: { Obs: [{ Code: 10217, Msg: "El credito\u0007 fiscal discriminado…" }] } }] } } },
    });

    it("registro exitoso → Mensaje conserva las Observaciones; no queda pendiente", async () => {
      wsfe.on("FECAESolicitar", conObs());
      const r = await emitir();
      expect(r.json).toMatchObject({ estado: "Autorizada", mensaje: "10217: El credito fiscal discriminado…" });
      expect(rows()[0].fields[F.mensaje]).toBe("10217: El credito fiscal discriminado…");
      expect(rows()[0].fields[F.venta]).toHaveLength(1);
      const c = (await estado()).json.comprobantes[0];
      expect(c).toMatchObject({ pendienteRegistro: false, completable: false, mensaje: "10217: El credito fiscal discriminado…" });
      expect((await completar(r.json.id)).status).toBe(409);
    });

    it("registro fallido → pendiente por datos (sin link a la Venta), Mensaje con las Observaciones; «Completar registro» idempotente y las conserva", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("KAIROS_FAULT_INJECTION", "factura:horas:0");
      wsfe.on("FECAESolicitar", conObs());
      const r = await emitir();
      expect(r.json.mensaje).toBe(`${FACTURA_MESSAGES.faltaRegistro}\n10217: El credito fiscal discriminado…`);
      expect(rows()[0].fields[F.mensaje]).toBe("10217: El credito fiscal discriminado…");
      expect((await estado()).json.comprobantes[0]).toMatchObject({ pendienteRegistro: true, completable: true });
      // No depende del texto: aunque se borre Mensaje, sigue pendiente.
      delete rows()[0].fields[F.mensaje];
      expect((await estado()).json.comprobantes[0]).toMatchObject({ pendienteRegistro: true, completable: true });
      rows()[0].fields[F.mensaje] = "10217: El credito fiscal discriminado…";
      vi.stubEnv("KAIROS_FAULT_INJECTION", "");
      expect((await completar(r.json.id)).json).toMatchObject({ estado: "Autorizada", mensaje: "10217: El credito fiscal discriminado…" });
      expect(rows()[0].fields[F.mensaje]).toBe("10217: El credito fiscal discriminado…");
      expect(fake.rows(T.ventas.id)).toHaveLength(1);
      expect(estadoHora(ids.h1)).toBe("Facturada");
      expect((await estado()).json.comprobantes[0]).toMatchObject({ pendienteRegistro: false, completable: false });
      expect((await completar(r.json.id)).status).toBe(409);
      expect(fake.rows(T.ventas.id)).toHaveLength(1);
    });

    it("una registrada cuyo Mensaje dice «falta registrar» NO se considera pendiente", async () => {
      const r = await emitir();
      rows()[0].fields[F.mensaje] = FACTURA_MESSAGES.faltaRegistro;
      expect((await estado()).json.comprobantes[0]).toMatchObject({ pendienteRegistro: false, completable: false });
      expect((await completar(r.json.id)).status).toBe(409);
    });
  });
});

describe("CC-F5-12 · guardas de borrado sin depender de los links (F-10)", () => {
  beforeEach(login);
  const ceRow = (ambiente: string, estado: string, horas: string[], extra: Record<string, unknown> = {}) =>
    fake.seed(CE.id, {
      [F.tipo]: "Factura A", [F.ambiente]: ambiente, [F.estado]: estado, [F.cliente]: [ids.cliente], [F.mes]: "2026-10-01",
      [F.datos]: JSON.stringify({ version: 1, ambiente, tipo: "Factura A", cbteTipo: 1, emisor: {}, receptor: { cuit: CUIT_CLIENTE }, importes: {}, detalle: {}, puntoVenta: 7, horas }),
      ...extra,
    });

  it("Producción: falla el update final de links (Venta creada, horas Facturada) → Autorizada y pendiente; Venta y horas no se borran; «Completar registro» linkea y una segunda vez → 409", async () => {
    usarProduccion();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "factura:links");
    const r = await emitir();
    expect(r.json).toMatchObject({ estado: "Autorizada", mensaje: FACTURA_MESSAGES.faltaRegistro });
    const rec = rows()[0];
    expect(rec.fields[F.venta]).toBeUndefined();
    expect(rec.fields[F.claveArca]).toBe(`1|7|1|${CUIT_CLIENTE}`);
    const [venta] = fake.rows(T.ventas.id);
    expect(venta.fields[V.claveArca]).toBe(`1|7|1|${CUIT_CLIENTE}`);
    expect([estadoHora(ids.h1), estadoHora(ids.h2)]).toEqual(["Facturada", "Facturada"]);
    expect((await estado()).json.comprobantes[0]).toMatchObject({ pendienteRegistro: true, completable: true });
    // Sin links inversos: las guardas miran la Clave ARCA y el snapshot.
    expect(await deleteComprobante("ventas", venta.id)).toMatchObject({ ok: false, status: 409 });
    for (const h of [ids.h1, ids.h2]) expect(await deleteHora(h)).toMatchObject({ ok: false, status: 409 });
    expect(fake.rows(T.ventas.id)).toHaveLength(1);
    expect(fake.rows(T.horas.id).some((h) => h.id === ids.h1)).toBe(true);
    vi.stubEnv("KAIROS_FAULT_INJECTION", "");
    expect((await completar(r.json.id)).json.estado).toBe("Autorizada");
    expect(rows()[0].fields).toMatchObject({ [F.venta]: [venta.id], [F.horas]: [ids.h1, ids.h2] });
    expect(fake.rows(T.ventas.id)).toHaveLength(1);
    expect((await completar(r.json.id)).status).toBe(409);
  });

  it("deleteHora: en el snapshot de una Producción En proceso o Incierta (sin links) → 409; Homologación o Rechazada → se borra", async () => {
    for (const estado of ["En proceso", "Incierta", "Autorizada"]) {
      const ce = ceRow("Producción", estado, [ids.h1]);
      expect(await deleteHora(ids.h1)).toMatchObject({ ok: false, status: 409 });
      fake.rows(CE.id).splice(fake.rows(CE.id).findIndex((x) => x.id === ce), 1);
    }
    ceRow("Homologación", "Autorizada", [ids.h1]);
    ceRow("Producción", "Rechazada", [ids.h1]);
    // El ID aparece como texto en otra parte del JSON pero no en `horas` → no bloquea (no es substring).
    ceRow("Producción", "Incierta", [], { [F.mensaje]: ids.h1, [F.comprobante]: ids.h1 });
    expect(await deleteHora(ids.h1)).toMatchObject({ ok: true });
  });

  it("deleteHora: el ID solo como texto dentro de Datos (fuera de `horas`) no bloquea; Datos ilegible tampoco", async () => {
    fake.seed(CE.id, { [F.tipo]: "Factura A", [F.ambiente]: "Producción", [F.estado]: "Incierta", [F.datos]: JSON.stringify({ version: 1, nota: ids.h2, horas: [] }) });
    fake.seed(CE.id, { [F.tipo]: "Factura A", [F.ambiente]: "Producción", [F.estado]: "Incierta", [F.datos]: `{roto ${ids.h2}` });
    expect(await deleteHora(ids.h2)).toMatchObject({ ok: true });
  });

  it("deleteComprobante: Clave ARCA de una Homologación → se borra; de una Producción Autorizada → 409", async () => {
    const venta = (clave: string) => fake.seed(T.ventas.id, { [V.claveArca]: clave, [V.tipoComprobante]: [ids.fa] });
    const homo = venta("1|1|5|30000000007");
    ceRow("Homologación", "Autorizada", [], { [F.claveArca]: "1|1|5|30000000007" });
    expect(await deleteComprobante("ventas", homo)).toMatchObject({ ok: true });
    const prod = venta("1|7|9|30000000007");
    ceRow("Producción", "Autorizada", [], { [F.claveArca]: "1|7|9|30000000007" });
    expect(await deleteComprobante("ventas", prod)).toMatchObject({ ok: false, status: 409, error: "Esta venta es de una factura emitida desde la app: no se puede borrar." });
    // Una Producción Rechazada o Incierta con esa clave no bloquea (solo Autorizada).
    const otra = venta("1|7|10|30000000007");
    ceRow("Producción", "Incierta", [], { [F.claveArca]: "1|7|10|30000000007" });
    expect(await deleteComprobante("ventas", otra)).toMatchObject({ ok: true });
  });

  it("fail-closed: si «Comprobantes emitidos» no se puede leer → 503 y no se borra nada", async () => {
    const venta = fake.seed(T.ventas.id, { [V.claveArca]: "1|7|9|30000000007", [V.tipoComprobante]: [ids.fa] });
    fake.fail("list", CE.id);
    expect(await deleteHora(ids.h1)).toMatchObject({ ok: false, status: 503 });
    expect(await deleteComprobante("ventas", venta)).toMatchObject({ ok: false, status: 503 });
    expect(fake.calls.filter((c) => c.method === "delete")).toHaveLength(0);
  });

  // Afip SDK responde 400/401/403 antes de procesar el pedido en ARCA (pedido inválido o token sin
  // permisos): no hay factura emitida que reconciliar, así que es definitivo → Rechazada (la clave queda
  // libre). 429/5xx/red/respuesta ilegible, en cambio, no garantizan eso → Incierta.
  it.each([
    [400, { message: "Error\u0007 de validación del pedido" }, "400: Error de validación del pedido"],
    [401, {}, "La integración con ARCA no está configurada correctamente."],
    [403, {}, "La integración con ARCA no está configurada correctamente."],
  ])("FECAESolicitar HTTP %s de Afip SDK → Rechazada, un solo intento, mensaje saneado, sin CAE", async (status, body, mensaje) => {
    wsfe.on("FECAESolicitar", { status, body });
    const r = await emitir();
    expect(r.json).toMatchObject({ estado: "Rechazada", mensaje });
    expect(wsfe.calls("FECAESolicitar")).toHaveLength(1);
    expect(rows()[0].fields).toMatchObject({ [F.estado]: "Rechazada", [F.mensaje]: mensaje });
    expect(rows()[0].fields[F.cae]).toBeUndefined();
    expect(String(rows()[0].fields[F.mensaje])).not.toMatch(/[\u0000-\u001f]/);
    expect((await estado()).json.elegible).toBe(true);
  });

  it("Producción Autorizada con Datos mal formado → «Revisar manualmente», sin «Completar registro»; el endpoint la rechaza", async () => {
    usarProduccion();
    const id = fake.seed(CE.id, { [F.tipo]: "Factura A", [F.ambiente]: "Producción", [F.estado]: "Autorizada", [F.cliente]: [ids.cliente], [F.mes]: "2026-10-01", [F.numero]: 3, [F.cae]: "70000000000003", [F.datos]: "{no es json" });
    const c = (await estado()).json.comprobantes.find((x: { id: string }) => x.id === id);
    expect(c).toMatchObject({ datosIncompletos: true, pendienteRegistro: false, completable: false, pdf: false });
    expect((await completar(id)).status).toBe(409);
    expect(fake.rows(T.ventas.id)).toHaveLength(0);
  });
});

describe("CC-F5-13 · F-11 (guarda de Ventas siempre lee) y F-12 (horas que cambian mientras se emite)", () => {
  beforeEach(login);
  const snapshot = (over: Record<string, unknown> = {}) => JSON.stringify({ version: 1, ambiente: "Producción", tipo: "Factura A", cbteTipo: 1, emisor: {}, receptor: { cuit: CUIT_CLIENTE }, importes: { total: 1 }, detalle: {}, puntoVenta: 7, horas: [], numero: 12, cae: "70000000000012", vencimientoCae: "2026-11-29", ...over });
  const venta = (clave: string) => fake.seed(T.ventas.id, { ...(clave ? { [V.claveArca]: clave } : {}), [V.tipoComprobante]: [ids.fa] });
  const clave = `1|7|12|${CUIT_CLIENTE}`;

  it("F-11: Venta con Clave ARCA vacía → la guarda igual lee (falla de lectura → 503, cero borrados)", async () => {
    const v = venta("");
    fake.fail("list", CE.id);
    expect(await deleteComprobante("ventas", v)).toMatchObject({ ok: false, status: 503 });
    expect(fake.calls.filter((c) => c.method === "delete")).toHaveLength(0);
    expect(fake.calls.some((c) => c.method === "list" && c.tableId === CE.id)).toBe(true);
  });

  it("F-11: Venta con Clave ARCA vacía y lectura ok → se borra (una clave vacía nunca coincide)", async () => {
    fake.seed(CE.id, { [F.ambiente]: "Producción", [F.estado]: "Autorizada", [F.datos]: snapshot() });
    const v = venta("");
    expect(await deleteComprobante("ventas", v)).toMatchObject({ ok: true });
    expect(fake.calls.some((c) => c.method === "list" && c.tableId === CE.id)).toBe(true);
  });

  it("F-11: Producción Autorizada con «Clave ARCA» vacía pero snapshot válido que coincide → 409; Homologación o Incierta → se borra", async () => {
    const homo = venta(clave);
    fake.seed(CE.id, { [F.ambiente]: "Homologación", [F.estado]: "Autorizada", [F.datos]: snapshot({ ambiente: "Homologación" }) });
    fake.seed(CE.id, { [F.ambiente]: "Producción", [F.estado]: "Incierta", [F.datos]: snapshot() });
    expect(await deleteComprobante("ventas", homo)).toMatchObject({ ok: true });
    const prod = venta(clave);
    fake.seed(CE.id, { [F.ambiente]: "Producción", [F.estado]: "Autorizada", [F.datos]: snapshot() });
    expect(await deleteComprobante("ventas", prod)).toMatchObject({ ok: false, status: 409, error: "Esta venta es de una factura emitida desde la app: no se puede borrar." });
  });

  /** Ejecuta `cambio` justo después de que se crea el registro «En proceso» (antes de la relectura). */
  function alCrearElRegistro(cambio: () => void) {
    const original = fake.client.create;
    fake.client.create = (async (tableId: string, records: Record<string, unknown>[]) => {
      const out = await original(tableId, records);
      if (tableId === CE.id) cambio();
      return out;
    }) as typeof original;
    return () => void (fake.client.create = original);
  }

  it.each([
    ["se borró", () => fake.rows(T.horas.id).splice(fake.rows(T.horas.id).findIndex((h) => h.id === ids.h2), 1)],
    ["pasó a Facturada", () => void (fake.rows(T.horas.id).find((h) => h.id === ids.h2)!.fields[Hf.estadoFacturacion] = "Facturada")],
    ["dejó de ser facturable", () => void (fake.rows(T.horas.id).find((h) => h.id === ids.h2)!.fields[Hf.facturable] = false)],
  ])("F-12: una hora incluida %s entre la creación del registro y la relectura → Rechazada, cero llamadas a WSFE", async (_l, cambio) => {
    const restore = alCrearElRegistro(cambio as () => void);
    try {
      const r = await emitir();
      expect(r.json).toMatchObject({ estado: "Rechazada", mensaje: FACTURA_MESSAGES.horasCambiaron });
      expect(rows()[0].fields).toMatchObject({ [F.estado]: "Rechazada", [F.mensaje]: FACTURA_MESSAGES.horasCambiaron });
      expect(wsfe.requests).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("F-12: si la relectura de horas falla → Rechazada y 503, sin WSFE", async () => {
    const restore = alCrearElRegistro(() => fake.failWhen((c) => c.method === "list" && c.tableId === T.horas.id));
    try {
      const r = await emitir();
      expect(r).toMatchObject({ status: 503, json: { error: FACTURA_MESSAGES.horasNoVerificadas } });
      expect(rows()[0].fields[F.estado]).toBe("Rechazada");
      expect(wsfe.requests).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("F-12: registrar con una hora que ya no existe → Venta creada, las otras Facturada, IDs faltantes en Mensaje (con las Observaciones), sin error", async () => {
    usarProduccion();
    wsfe.on("FECAESolicitar", { body: { FECAESolicitarResult: { FeCabResp: { Resultado: "A" }, FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CAE: "70000000000055", CAEFchVto: "20261129", Observaciones: { Obs: { Code: 10217, Msg: "Obs" } } }] } } } });
    // La hora h2 desaparece justo después de autorizar (antes del registro).
    const original = fake.client.update;
    fake.client.update = (async (tableId: string, records: { id: string; fields: Record<string, unknown> }[]) => {
      const out = await original(tableId, records);
      if (tableId === CE.id && records[0].fields[F.estado] === "Autorizada") fake.rows(T.horas.id).splice(fake.rows(T.horas.id).findIndex((h) => h.id === ids.h2), 1);
      return out;
    }) as typeof original;
    try {
      const r = await emitir();
      expect(r.json.estado).toBe("Autorizada");
      expect(fake.rows(T.ventas.id)).toHaveLength(1);
      expect(estadoHora(ids.h1)).toBe("Facturada");
      const rec = rows()[0];
      expect(rec.fields[F.horas]).toEqual([ids.h1]);
      expect(rec.fields[F.venta]).toEqual([fake.rows(T.ventas.id)[0].id]);
      expect(rec.fields[F.mensaje]).toBe(`10217: Obs\n${FACTURA_MESSAGES.horasFaltantes([ids.h2])}`);
      expect((await estado()).json.comprobantes[0]).toMatchObject({ pendienteRegistro: false, completable: false });
      expect(parseDatos(rec.fields[F.datos])!.horas).toEqual([ids.h1, ids.h2]);
    } finally {
      fake.client.update = original;
    }
  });

  it("Homologación: la autorización deja «Clave ARCA» vacía", async () => {
    const r = await emitir();
    expect(r.json.estado).toBe("Autorizada");
    expect(rows()[0].fields[F.claveArca]).toBeUndefined();
    const final = fake.calls.filter((c) => c.method === "update" && c.tableId === CE.id).map((c) => (c.payload as { fields: Record<string, unknown> }[])[0].fields).find((f) => f[F.estado] === "Autorizada")!;
    expect(F.claveArca in final).toBe(false);
  });
});

describe("CC-F5-14 · F-13: la clave se libera de verdad tras un rechazo previo a WSFE", () => {
  beforeEach(login);

  function alCrearElRegistro(cambio: () => void) {
    const original = fake.client.create;
    fake.client.create = (async (tableId: string, records: Record<string, unknown>[]) => {
      const out = await original(tableId, records);
      if (tableId === CE.id) cambio();
      return out;
    }) as typeof original;
    return () => void (fake.client.create = original);
  }
  const hacerFacturada = () => void (fake.rows(T.horas.id).find((h) => h.id === ids.h2)!.fields[Hf.estadoFacturacion] = "Facturada");
  let relecturaFalla = false;
  const fallaRelectura = () => {
    relecturaFalla = true;
    fake.failWhen((c) => relecturaFalla && c.method === "list" && c.tableId === T.horas.id);
  };
  const casos: [string, () => void, number, string][] = [
    ["horas que cambiaron", hacerFacturada, 200, FACTURA_MESSAGES.horasCambiaron],
    ["relectura de horas fallida", fallaRelectura, 503, FACTURA_MESSAGES.horasNoVerificadas],
  ];

  it.each(casos)("%s: si el update a Rechazada falla, se borra el registro (clave libre, cero WSFE)", async (_l, cambio, status) => {
    let fallar = true;
    fake.failWhen((c) => fallar && c.method === "update" && c.tableId === CE.id && (c.payload as { fields: Record<string, unknown> }[])[0].fields[F.estado] === "Rechazada");
    const restore = alCrearElRegistro(cambio);
    try {
      const r = await emitir();
      expect(r.status).toBe(status);
      expect(rows()).toHaveLength(0);
      expect(fake.calls.some((c) => c.method === "delete" && c.tableId === CE.id)).toBe(true);
      expect(wsfe.requests).toHaveLength(0);
    } finally {
      restore();
      fallar = false;
      relecturaFalla = false;
    }
    // Clave libre: si las horas siguen pendientes, se puede volver a emitir.
    if (status === 503) expect((await emitir()).json.estado).toBe("Autorizada");
  });

  it.each(casos)("%s: si fallan el update y el borrado → 503 «No pudimos liberar…», cero WSFE; «Verificar en ARCA» a los 5 min (sin Número) → Rechazada sin WSFE; después se puede emitir", async (_l, cambio) => {
    let fallar = true;
    fake.failWhen((c) => fallar && c.tableId === CE.id && (c.method === "delete" || (c.method === "update" && (c.payload as { fields: Record<string, unknown> }[])[0].fields[F.estado] === "Rechazada")));
    const restore = alCrearElRegistro(cambio);
    let id: string;
    try {
      const r = await emitir();
      expect(r).toMatchObject({ status: 503, json: { error: FACTURA_MESSAGES.noLiberada } });
      expect(wsfe.requests).toHaveLength(0);
      expect(rows()).toHaveLength(1);
      id = rows()[0].id;
      expect(rows()[0].fields[F.estado]).toBe("En proceso");
      expect(rows()[0].fields[F.numero]).toBeUndefined();
      expect(consoleLines.join("\n")).toContain(id);
    } finally {
      restore();
      fallar = false;
      relecturaFalla = false;
    }
    // La clave sigue ocupada mientras tanto.
    expect((await estado()).json.motivos).toContain(FACTURA_MESSAGES.yaEmitida("Homologación", "En proceso"));
    expect((await verificar(id)).status).toBe(409); // todavía no está colgado
    vi.setSystemTime(new Date("2026-11-19T15:06:00Z"));
    const v = await verificar(id);
    expect(v.json).toMatchObject({ estado: "Rechazada", mensaje: FACTURA_MESSAGES.noLlegoArca });
    expect(wsfe.requests).toHaveLength(0);
    if (cambio === hacerFacturada) fake.rows(T.horas.id).find((h) => h.id === ids.h2)!.fields[Hf.estadoFacturacion] = "Pendiente";
    expect((await emitir()).json.estado).toBe("Autorizada");
  });

  it("un colgado SIN Número se rechaza aunque la factura no esté configurada (sin WSFE); con Número sigue la verificación de siempre", async () => {
    const sin = fake.seed(CE.id, { [F.tipo]: "Factura A", [F.ambiente]: "Homologación", [F.estado]: "En proceso", [F.cliente]: [ids.cliente], [F.mes]: "2026-10-01", [F.iniciado]: "2026-11-19T14:00:00.000Z" });
    vi.stubEnv("AFIP_SDK_TOKEN", "");
    expect((await verificar(sin)).json).toMatchObject({ estado: "Rechazada", mensaje: FACTURA_MESSAGES.noLlegoArca });
    vi.stubEnv("AFIP_SDK_TOKEN", TOKEN);
    const con = fake.seed(CE.id, {
      [F.tipo]: "Factura A", [F.ambiente]: "Homologación", [F.estado]: "En proceso", [F.cliente]: [ids.cliente], [F.mes]: "2026-09-01", [F.iniciado]: "2026-11-19T14:00:00.000Z", [F.numero]: 4,
      [F.datos]: JSON.stringify({ version: 1, ambiente: "Homologación", tipo: "Factura A", cbteTipo: 1, emisor: { cuit: "20409378472" }, receptor: { cuit: CUIT_CLIENTE }, importes: { total: TOTAL }, detalle: {}, puntoVenta: 1, horas: [], fechaEmision: "2026-11-19" }),
    });
    wsfe.setUltimo(2);
    expect((await verificar(con)).json).toMatchObject({ estado: "Rechazada", mensaje: FACTURA_MESSAGES.noEmitida });
    expect(wsfe.calls("FECompUltimoAutorizado")).toHaveLength(1);
  });

  describe("nota de horas faltantes (Producción)", () => {
    beforeEach(usarProduccion);
    const updateOriginal = fake.client.update;
    afterEach(() => void (fake.client.update = updateOriginal));
    /** Agrega `n` horas Pendiente al cliente/mes y las borra justo después de autorizar (se restaura en afterEach). */
    function horasQueDesaparecen(n: number): string[] {
      const extra = Array.from({ length: n }, (_, i) =>
        fake.seed(T.horas.id, { [Hf.fecha]: "2026-10-20", [Hf.proyecto]: [ids.web], [Hf.colaborador]: [ids.admin], [Hf.tarea]: `x${i}`, [Hf.horaDesde]: t("09:00"), [Hf.horaHasta]: t("09:06"), [Hf.facturable]: true }),
      );
      const original = fake.client.update;
      fake.client.update = (async (tableId: string, records: { id: string; fields: Record<string, unknown> }[]) => {
        const out = await original(tableId, records);
        if (tableId === CE.id && records[0].fields[F.estado] === "Autorizada")
          for (const h of extra) {
            const i = fake.rows(T.horas.id).findIndex((x) => x.id === h);
            if (i >= 0) fake.rows(T.horas.id).splice(i, 1);
          }
        return out;
      }) as typeof original;
      return extra;
    }

    it("más de 20 horas faltantes → la nota lista 20 IDs y «y N más», una sola vez", async () => {
      const extra = horasQueDesaparecen(23);
      const r = await emitir();
      expect(r.json.estado).toBe("Autorizada");
      const m = String(rows()[0].fields[F.mensaje]);
      expect(m).toBe(FACTURA_MESSAGES.horasFaltantes(extra));
      expect(m).toContain("y 3 más.");
      expect(m.split("\n")).toHaveLength(1);
      expect(extra.slice(0, 20).every((id) => m.includes(id))).toBe(true);
      expect(m.includes(extra[20])).toBe(false);
      expect(rows()[0].fields[F.venta]).toHaveLength(1);
    });

    it("«Completar registro» que falla después de anotar la nota → el reintento completa sin duplicar la nota ni la Venta", async () => {
      const extra = horasQueDesaparecen(2);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("KAIROS_FAULT_INJECTION", "factura:links");
      const r = await emitir();
      expect(r.json.estado).toBe("Autorizada");
      const nota = FACTURA_MESSAGES.horasFaltantes(extra);
      expect(rows()[0].fields[F.mensaje]).toBe(nota);
      expect(rows()[0].fields[F.venta]).toBeUndefined();
      // Primer «Completar registro»: vuelve a fallar en los links (la nota ya estaba).
      expect((await completar(r.json.id)).status).toBe(503);
      expect(rows()[0].fields[F.mensaje]).toBe(nota);
      vi.stubEnv("KAIROS_FAULT_INJECTION", "");
      const ok = await completar(r.json.id);
      expect(ok.json).toMatchObject({ estado: "Autorizada", mensaje: nota });
      expect(rows()[0].fields[F.mensaje]).toBe(nota);
      expect(String(rows()[0].fields[F.mensaje]).split(nota)).toHaveLength(2);
      expect(fake.rows(T.ventas.id)).toHaveLength(1);
      expect(rows()[0].fields[F.venta]).toEqual([fake.rows(T.ventas.id)[0].id]);
      expect((await completar(r.json.id)).status).toBe(409);
    });
  });
});
