import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { mapPersona, PADRON_MESSAGES } from "@/lib/padron/padron";
import { cuitSintetico } from "./arca-fixture";
import { createFakeAirtable } from "./fake-airtable";

/**
 * Padrón de ARCA (F5-05 · CC-F5-18): mapeo puro de getPersona_v2 + ruta
 * POST /api/admin/clientes/padron con Airtable falso y Afip SDK falso (fetch global).
 * Nunca se llama a Afip SDK real. Datos sintéticos.
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
const route = await import("@/app/api/admin/clientes/padron/route");
const { getPadronStatus } = await import("@/lib/padron/server/padron");

const T = TABLES;
const U = T.usuarios.fields;
const PA = T.parametros.fields;
const CUIT_CLIENTE = cuitSintetico("30", 71234567);
const CUIT_EMPRESA = cuitSintetico("30", 70000000);
const TOKEN = "tok_test_afip_padron_123";
const CERT_PEM = "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUcertificadoFalsoDePrueba0000\n-----END CERTIFICATE-----";
const KEY_PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANclaveFalsaDePruebaNoEsReal0000000000\n-----END PRIVATE KEY-----";
const b64 = (s: string) => Buffer.from(s).toString("base64");

// ── Respuestas sintéticas con la forma observada en CC-F5-17 ───────────────────
const juridica = (over: Record<string, unknown> = {}) => ({
  personaReturn: {
    datosGenerales: {
      domicilioFiscal: { codPostal: "1000", descripcionProvincia: "CIUDAD AUTONOMA BUENOS AIRES", direccion: "AV QA 742 Piso:3", idProvincia: 0, tipoDomicilio: "FISCAL" },
      estadoClave: "ACTIVO",
      idPersona: Number(CUIT_CLIENTE),
      razonSocial: "QA CLIENTE SA",
      tipoClave: "CUIT",
      tipoPersona: "JURIDICA",
    },
    datosRegimenGeneral: {
      impuesto: [
        { idImpuesto: 10, descripcionImpuesto: "GANANCIAS SOCIEDADES", estadoImpuesto: "AC", periodo: 202001 },
        { idImpuesto: 30, descripcionImpuesto: "IVA", estadoImpuesto: "AC", periodo: 202001 },
      ],
    },
    metadata: { fechaHora: "2026-11-23T00:00:00.000Z", servidor: "setiwsh2" },
    ...over,
  },
});
const fisica = (over: Record<string, unknown> = {}) => ({
  personaReturn: {
    datosGenerales: {
      apellido: "PEREZ",
      nombre: "JUAN CARLOS",
      tipoPersona: "FISICA",
      estadoClave: "ACTIVO",
      domicilioFiscal: { direccion: "CALLE QA 123", localidad: "SAN ISIDRO", descripcionProvincia: "BUENOS AIRES", codPostal: "1642", tipoDomicilio: "FISCAL" },
    },
    datosMonotributo: { categoriaMonotributo: { idImpuesto: 20, descripcionCategoria: "D LOCACIONES DE SERVICIO" }, impuesto: { idImpuesto: 20, descripcionImpuesto: "MONOTRIBUTO" } },
    ...over,
  },
});

describe("mapeo de getPersona_v2", () => {
  it("JURIDICA → razonSocial; domicilio sin localidad ni código postal; RI por impuesto 30 AC", () => {
    expect(mapPersona(juridica())).toEqual({
      found: true,
      razonSocial: "QA CLIENTE SA",
      domicilio: "AV QA 742 Piso:3 - CIUDAD AUTONOMA BUENOS AIRES",
      condicionIva: "Responsable Inscripto",
      avisos: [],
    });
  });

  it("FISICA → «apellido nombre»; domicilio con localidad; Monotributista por datosMonotributo", () => {
    const m = mapPersona(fisica());
    expect(m).toMatchObject({ found: true, razonSocial: "PEREZ JUAN CARLOS", domicilio: "CALLE QA 123 - SAN ISIDRO, BUENOS AIRES", condicionIva: "Monotributista", avisos: [] });
  });

  it("FISICA ignora razonSocial; JURIDICA ignora apellido/nombre", () => {
    const f = fisica();
    (f.personaReturn.datosGenerales as Record<string, unknown>).razonSocial = "NO USAR";
    expect(mapPersona(f)).toMatchObject({ razonSocial: "PEREZ JUAN CARLOS" });
    const j = juridica();
    Object.assign(j.personaReturn.datosGenerales, { apellido: "X", nombre: "Y" });
    expect(mapPersona(j)).toMatchObject({ razonSocial: "QA CLIENTE SA" });
  });

  it("datoAdicional se agrega solo si viene; partes faltantes se omiten", () => {
    const j = juridica();
    Object.assign(j.personaReturn.datosGenerales.domicilioFiscal, { localidad: "PALERMO", datoAdicional: "LOCAL 2", tipoDatoAdicional: "OF" });
    expect(mapPersona(j)).toMatchObject({ domicilio: "AV QA 742 Piso:3 - PALERMO, CIUDAD AUTONOMA BUENOS AIRES - LOCAL 2" });
    const solo = juridica();
    solo.personaReturn.datosGenerales.domicilioFiscal = { direccion: "AV QA 1" } as never;
    expect(mapPersona(solo)).toMatchObject({ domicilio: "AV QA 1" });
    const sinDir = juridica();
    sinDir.personaReturn.datosGenerales.domicilioFiscal = { descripcionProvincia: "CORDOBA" } as never;
    expect(mapPersona(sinDir)).toMatchObject({ domicilio: "CORDOBA" });
    const nada = juridica();
    delete (nada.personaReturn.datosGenerales as Record<string, unknown>).domicilioFiscal;
    expect(mapPersona(nada)).toMatchObject({ domicilio: null });
  });

  it("listas de un solo elemento como objeto o como array dan lo mismo", () => {
    const obj = juridica({ datosRegimenGeneral: { impuesto: { idImpuesto: 30, estadoImpuesto: "AC" } } });
    const arr = juridica({ datosRegimenGeneral: [{ impuesto: [{ idImpuesto: "30", estadoImpuesto: "AC" }] }] });
    const dom = juridica();
    (dom.personaReturn.datosGenerales as Record<string, unknown>).domicilioFiscal = [juridica().personaReturn.datosGenerales.domicilioFiscal];
    for (const b of [obj, arr, dom]) expect(mapPersona(b)).toMatchObject({ condicionIva: "Responsable Inscripto", domicilio: "AV QA 742 Piso:3 - CIUDAD AUTONOMA BUENOS AIRES" });
    expect(mapPersona({ personaReturn: [juridica().personaReturn] })).toMatchObject({ found: true, razonSocial: "QA CLIENTE SA" });
  });

  it("condición IVA indeterminada → null con aviso; nunca adivina (IVA inactivo, exento, sin datos, RI y monotributo a la vez)", () => {
    const inactivo = juridica({ datosRegimenGeneral: { impuesto: [{ idImpuesto: 30, estadoImpuesto: "BD" }] } });
    const exento = juridica({ datosRegimenGeneral: { impuesto: [{ idImpuesto: 32, descripcionImpuesto: "IVA EXENTO", estadoImpuesto: "AC" }] } });
    const sin = juridica({ datosRegimenGeneral: undefined });
    for (const b of [inactivo, exento, sin]) expect(mapPersona(b)).toMatchObject({ condicionIva: null, avisos: [PADRON_MESSAGES.ivaIndeterminada] });
    const ambos = juridica({ datosMonotributo: { impuesto: { idImpuesto: 20 } } });
    expect(mapPersona(ambos)).toMatchObject({ condicionIva: null, avisos: [PADRON_MESSAGES.ivaAmbigua] });
  });

  it("no figura: personaReturn null, ausente o vacío", () => {
    for (const b of [{ personaReturn: null }, {}, null, "x", { personaReturn: {} }, { personaReturn: { metadata: {} } }]) expect(mapPersona(b)).toEqual({ found: false });
  });

  it("estadoClave ≠ ACTIVO y bloques de error → devuelve lo que hay más avisos saneados (sin controles, ≤ 300, ≤ 5)", () => {
    const largo = "X".repeat(400);
    const b = juridica({
      errorConstancia: { error: ["La CUIT \u0007se encuentra\nLIMITADA", largo], idPersona: 1 },
      errorRegimenGeneral: { error: "Domicilio fiscal incompleto" },
      errorMonotributo: { error: ["e1", "e2", "e3"] },
    });
    b.personaReturn.datosGenerales.estadoClave = "INACTIVO";
    const m = mapPersona(b);
    expect(m).toMatchObject({ found: true, razonSocial: "QA CLIENTE SA", condicionIva: "Responsable Inscripto" });
    if (!m.found) throw new Error("found");
    expect(m.avisos[0]).toBe(PADRON_MESSAGES.estado("INACTIVO"));
    const errores = m.avisos.slice(1);
    expect(errores).toHaveLength(5);
    expect(errores[0]).toBe("ARCA (constancia): La CUIT se encuentra LIMITADA");
    expect(errores[1].length).toBeLessThanOrEqual(300);
    expect(errores[1].endsWith("…")).toBe(true);
    expect(errores[2]).toBe("ARCA (régimen general): Domicilio fiscal incompleto");
    for (const a of m.avisos) expect(a).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });

  it("solo un bloque de error (sin datosGenerales) → found con nulls y el aviso", () => {
    const m = mapPersona({ personaReturn: { errorConstancia: { error: "No existe persona con ese Id" } } });
    expect(m).toMatchObject({ found: true, razonSocial: null, domicilio: null, condicionIva: null });
    if (m.found) expect(m.avisos).toContain("ARCA (constancia): No existe persona con ese Id");
  });
});

// ── Ruta ───────────────────────────────────────────────────────────────────────

type Reply = { status?: number; body?: unknown } | "network";
interface Req {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}
const requests: Req[] = [];
const queues = new Map<string, Reply[]>();
const on = (kind: "auth" | "persona", ...r: Reply[]) => queues.set(kind, [...(queues.get(kind) ?? []), ...r]);
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  requests.push({ path: url.pathname, body, headers: init?.headers as Record<string, string> });
  const kind = url.pathname.endsWith("/afip/auth") ? "auth" : "persona";
  const q = queues.get(kind);
  const r: Reply | undefined = q?.shift();
  if (r === "network") throw new TypeError("fetch failed");
  if (r) return Response.json(r.body ?? {}, { status: r.status ?? 200 });
  if (kind === "auth") return Response.json({ expiration: "2030-01-01T00:00:00.000Z", token: "TA-token-padron", sign: "TA-sign-padron" });
  return Response.json(juridica());
}) as unknown as typeof fetch;

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("clave-de-prueba", 4);
});

let ids: Record<string, string>;
let consoleLines: string[];
const responses: string[] = [];

beforeEach(() => {
  fake.reset();
  cookieJar.clear();
  clearUserCache();
  requests.length = 0;
  queues.clear();
  responses.length = 0;
  consoleLines = [];
  const capture = (...args: unknown[]) => void consoleLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.stubGlobal("fetch", fakeFetch);
  vi.stubEnv("AFIP_SDK_TOKEN", TOKEN);
  vi.stubEnv("AFIP_WSFE_ENV", "");
  vi.stubEnv("AFIP_CERT_B64", b64(CERT_PEM));
  vi.stubEnv("AFIP_KEY_B64", b64(KEY_PEM));
  const user = (email: string, rol: string) =>
    fake.seed(T.usuarios.id, { [U.nombre]: email, [U.email]: email, [U.rol]: rol, [U.sigla]: email.slice(0, 2).toUpperCase(), [U.estado]: "Activo", [U.debeCambiarPassword]: false, [U.passwordHash]: hash });
  ids = { admin: user("ana@kairos.test", "Admin"), empleado: user("emi@kairos.test", "Empleado") };
  ids.pCuit = fake.seed(T.parametros.id, { [PA.concepto]: "CUIT", [PA.valor]: CUIT_EMPRESA });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function login(userId = ids.admin) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}

async function consultar(body: unknown = { cuit: CUIT_CLIENTE }, headers: Record<string, string> = {}, raw?: string) {
  const cookie = cookieJar.get(SESSION_COOKIE);
  const req = new NextRequest("http://localhost/api/admin/clientes/padron", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}), ...headers },
  });
  const res = await (route.POST as unknown as (r: NextRequest, c: unknown) => Promise<Response>)(req, { params: Promise.resolve({}) });
  const text = await res.text();
  responses.push(text);
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
}

const writes = () => fake.calls.filter((c) => c.method !== "list");

describe("POST /api/admin/clientes/padron", () => {
  it("sin sesión → 401; Empleado → 403; nunca llama a Afip SDK", async () => {
    expect((await consultar()).status).toBe(401);
    await login(ids.empleado);
    expect((await consultar()).status).toBe(403);
    expect(requests).toHaveLength(0);
  });

  describe("como Admin", () => {
    beforeEach(() => login());

    it("ok: prod siempre (aunque AFIP_WSFE_ENV sea dev), cert/key, cuitRepresentada = Parámetros, idPersona = cliente; no-store; sin escrituras", async () => {
      const r = await consultar({ cuit: `${CUIT_CLIENTE.slice(0, 2)}-${CUIT_CLIENTE.slice(2, 10)}-${CUIT_CLIENTE.slice(10)}` });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true, razonSocial: "QA CLIENTE SA", domicilio: "AV QA 742 Piso:3 - CIUDAD AUTONOMA BUENOS AIRES", condicionIva: "Responsable Inscripto", avisos: [] });
      expect(r.headers.get("cache-control")).toContain("no-store");
      expect(requests.map((q) => q.path)).toEqual(["/api/v1/afip/auth", "/api/v1/afip/requests"]);
      expect(requests[0].body).toEqual({ environment: "prod", tax_id: CUIT_EMPRESA, wsid: "ws_sr_constancia_inscripcion", cert: CERT_PEM, key: KEY_PEM });
      expect(requests[1].body).toEqual({
        environment: "prod",
        method: "getPersona_v2",
        wsid: "ws_sr_constancia_inscripcion",
        params: { token: "TA-token-padron", sign: "TA-sign-padron", cuitRepresentada: Number(CUIT_EMPRESA), idPersona: Number(CUIT_CLIENTE) },
      });
      expect(writes()).toHaveLength(0);
      expect(fake.calls.every((c) => c.tableId === T.parametros.id || c.tableId === T.usuarios.id)).toBe(true);
    });

    it("body estricto, CUIT validada, Origin y JSON", async () => {
      for (const b of [{}, { cuit: CUIT_CLIENTE, extra: 1 }, { cuit: Number(CUIT_CLIENTE) }, { CUIT: CUIT_CLIENTE }]) expect((await consultar(b)).json.error).toBe(PADRON_MESSAGES.formato);
      expect((await consultar({ cuit: "123" })).status).toBe(400);
      expect((await consultar({ cuit: "30712345670" })).json.error).toMatch(/CUIT/);
      expect((await consultar(undefined, { origin: "https://evil.test" })).status).toBe(403);
      expect((await consultar(undefined, { "content-type": "text/plain" })).status).toBe(415);
      expect((await consultar(undefined, {}, "[1]")).status).toBe(400);
      expect(requests).toHaveLength(0);
      expect((await consultar(undefined, { origin: "http://localhost" })).status).toBe(200);
    });

    it("no configurado → 503 con el motivo, sin llamar a Afip SDK; el estado de la página dice lo mismo", async () => {
      const casos: [() => void, string][] = [
        [() => vi.stubEnv("AFIP_SDK_TOKEN", ""), PADRON_MESSAGES.sinToken],
        [() => vi.stubEnv("AFIP_CERT_B64", ""), PADRON_MESSAGES.sinCertificado],
        [() => vi.stubEnv("AFIP_KEY_B64", b64("-----BEGIN PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")), PADRON_MESSAGES.sinCertificado],
        [() => vi.stubEnv("AFIP_CERT_B64", "no es base64!"), PADRON_MESSAGES.sinCertificado],
      ];
      for (const [arrange, motivo] of casos) {
        vi.stubEnv("AFIP_SDK_TOKEN", TOKEN);
        vi.stubEnv("AFIP_CERT_B64", b64(CERT_PEM));
        vi.stubEnv("AFIP_KEY_B64", b64(KEY_PEM));
        arrange();
        expect(await getPadronStatus()).toEqual({ configured: false, motivo });
      }
      vi.stubEnv("AFIP_SDK_TOKEN", "");
      const r = await consultar();
      expect(r).toMatchObject({ status: 503, json: { error: PADRON_MESSAGES.sinToken } });
      vi.stubEnv("AFIP_SDK_TOKEN", TOKEN);
      vi.stubEnv("AFIP_KEY_B64", "");
      expect((await consultar()).json.error).toBe(PADRON_MESSAGES.sinCertificado);
      expect(requests).toHaveLength(0);
    });

    it("Parámetros «CUIT» vacía o inválida → no configurado; Parámetros ilegible → motivo propio", async () => {
      fake.reset();
      fake.seed(T.usuarios.id, {});
      expect(await getPadronStatus()).toEqual({ configured: false, motivo: PADRON_MESSAGES.sinCuitEmpresa });
      fake.seed(T.parametros.id, { [PA.concepto]: "CUIT", [PA.valor]: "30712345670" });
      expect(await getPadronStatus()).toEqual({ configured: false, motivo: PADRON_MESSAGES.sinCuitEmpresa });
      fake.fail("list", T.parametros.id);
      expect(await getPadronStatus()).toEqual({ configured: false, motivo: PADRON_MESSAGES.sinParametros });
    });

    it("configurado con AFIP_WSFE_ENV vacío (factura en Homologación)", async () => {
      expect(await getPadronStatus()).toEqual({ configured: true, motivo: null });
    });

    it("no figura → 404 (personaReturn null o 400 «No existe persona con ese Id»)", async () => {
      on("persona", { body: { personaReturn: null } });
      expect(await consultar()).toMatchObject({ status: 404, json: { error: PADRON_MESSAGES.noEncontrada } });
      on("persona", { status: 400, body: { message: "No existe persona con ese Id" } });
      expect(await consultar()).toMatchObject({ status: 404, json: { error: PADRON_MESSAGES.noEncontrada } });
      expect(writes()).toHaveLength(0);
    });

    it("estado inactivo y bloques de error → 200 con lo que hay y avisos", async () => {
      const b = juridica({ errorRegimenGeneral: { error: ["Domicilio fiscal incompleto"] } });
      b.personaReturn.datosGenerales.estadoClave = "INACTIVO";
      on("persona", { body: b });
      const r = await consultar();
      expect(r.status).toBe(200);
      expect(r.json.avisos).toEqual([PADRON_MESSAGES.estado("INACTIVO"), "ARCA (régimen general): Domicilio fiscal incompleto"]);
      expect(r.json.razonSocial).toBe("QA CLIENTE SA");
    });

    it("errores de Afip SDK/ARCA → mensajes de la app (nunca el del proveedor); reintenta lecturas", async () => {
      on("persona", { status: 400, body: { message: "Mensaje interno del proveedor 12345" } });
      expect(await consultar()).toMatchObject({ status: 400, json: { error: PADRON_MESSAGES.rechazo } });
      on("auth", { status: 400, body: { message: "Certificado vencido del proveedor" } });
      expect(await consultar()).toMatchObject({ status: 400, json: { error: PADRON_MESSAGES.rechazo } });
      on("auth", { status: 401 });
      expect(await consultar()).toMatchObject({ status: 503, json: { error: "La integración con ARCA no está configurada correctamente." } });
      on("persona", { body: { nada: 1 } });
      expect((await consultar()).status).toBe(404);
      on("auth", { body: { token: "" } });
      expect((await consultar()).status).toBe(503);
      requests.length = 0;
      on("persona", { status: 503 });
      expect((await consultar()).status).toBe(200);
      expect(requests.filter((q) => q.path.endsWith("/afip/requests"))).toHaveLength(2);
      expect(responses.join("\n")).not.toContain("proveedor");
      expect(writes()).toHaveLength(0);
    }, 20_000);

    it("token, certificado, clave, TA y bodies nunca en logs ni respuestas; los logs llevan solo {kind, status}", async () => {
      on("persona", { status: 400, body: { message: "detalle secreto del body" } });
      await consultar();
      on("auth", { status: 403 });
      await consultar();
      await consultar();
      const all = [...consoleLines, ...responses].join("\n");
      for (const s of [TOKEN, CERT_PEM, KEY_PEM, b64(CERT_PEM), b64(KEY_PEM), "TA-token-padron", "TA-sign-padron", "MIIEvQIBADAN", "detalle secreto", "AV QA 742"]) {
        if (s === "AV QA 742") expect(consoleLines.join("\n")).not.toContain(s);
        else expect(all).not.toContain(s);
      }
      for (const line of consoleLines.filter((l) => l.includes("Afip SDK"))) expect(line).toMatch(/\{"name":"AfipSdkError","kind":"\w+","status":\d+\}/);
    });
  });
});

describe("alcance", () => {
  it("Leads no tiene el botón ni llama al padrón; la ruta no importa nada que escriba en Airtable", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const files = readdirSync("components/leads", { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
    for (const f of files) {
      const src = readFileSync(`components/leads/${f}`, "utf8");
      expect(src).not.toContain("clientes/padron");
      expect(src).not.toContain("PadronButton");
      expect(src).not.toContain("MaestroManager");
    }
    const server = readFileSync("lib/padron/server/padron.ts", "utf8");
    expect(server).not.toMatch(/\.(create|update|delete)\(/);
  });
});
