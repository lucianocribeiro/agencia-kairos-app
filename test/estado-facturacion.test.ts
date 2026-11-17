import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { createFakeAirtable } from "./fake-airtable";

/**
 * Estado de facturación de las horas (CC-F4-08) por las rutas reales sobre un Airtable falso:
 * schema, alta/edición del Admin, Empleado (Pendiente, nunca lo ve), lote desde la selección
 * (fail-closed) y vista Cliente (filtro, desglose por estado, Excel). Datos sintéticos.
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
const { ESTADO_MESSAGES, estadoEfectivo } = await import("@/lib/horas/estado");
const { SELECCION_MESSAGES } = await import("@/lib/horas/seleccion");
const { CLIENTE_RESPONSE_KEYS } = await import("@/lib/cliente/types");
const { importeRegistro, ivaDe } = await import("@/lib/proforma/proforma");
const { readFirstSheet } = await import("@/lib/xlsx/read");
const { RESTRICTED_FIELDS } = await import("@/lib/airtable/schema");
const { HORA_INPUT_KEYS } = await import("@/lib/horas/rules");

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ALL = import.meta.glob<Record<string, Handler>>("/app/api/**/route.ts", { eager: true });
const AD_HORAS = "app/api/admin/horas/route.ts";
const AD_HORA = "app/api/admin/horas/[id]/route.ts";
const EST = "app/api/admin/horas/seleccion/estado/route.ts";
const ME_HORAS = "app/api/me/horas/route.ts";
const VISTA = "app/api/cliente/horas/route.ts";
const EXCEL = "app/api/cliente/horas/excel/route.ts";

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
    [H.tarea]: `Tarea ${fecha} ${desde}`,
    [H.horaDesde]: t(desde),
    [H.horaHasta]: t(hasta),
    [H.facturable]: true,
    [H.mesAFacturar]: `${fecha.slice(0, 7)}-01`,
    [H.cargadoPor]: [colaborador],
    ...extra,
  });
}

beforeEach(() => {
  fake.reset();
  cookieJar.clear();
  clearUserCache();
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const cli = fake.seed(C.id, { [C.fields.nombre]: "QA Cliente", [C.fields.sigla]: "QZ", [C.fields.estado]: "Activo" });
  const proyecto = (codigo: string, extra: Record<string, unknown>) => fake.seed(P.id, { [P.fields.codigo]: codigo, [P.fields.estado]: "Activo", [P.fields.cliente]: [cli], ...extra });
  const ars = proyecto("QZ - Web", { [P.fields.valorHora]: 1234.57, [P.fields.monedaValorHora]: "ARS" });
  const usd = proyecto("QZ - App", { [P.fields.valorHora]: 50, [P.fields.monedaValorHora]: "USD" });
  const user = (nombre: string, rol: string, extra: Record<string, unknown> = {}) =>
    fake.seed(TABLES.usuarios.id, {
      [U.nombre]: nombre,
      [U.email]: `${nombre.toLowerCase()}@kairos.test`,
      [U.rol]: rol,
      [U.estado]: "Activo",
      [U.debeCambiarPassword]: false,
      [U.passwordHash]: hash,
      ...extra,
    });
  const admin = user("Ana", "Admin", { [U.sigla]: "AA" });
  const eva = user("Eva", "Empleado", { [U.sigla]: "EV", [U.proyectosAsignados]: [ars, usd] });
  const cliUser = user("Carla", "Cliente", { [U.proyectosAsignados]: [ars, usd] });
  for (const p of [ars, usd]) fake.rows(P.id).find((r) => r.id === p)!.fields[P.fields.usuarios] = [eva, cliUser];
  fake.seed(TABLES.parametros.id, { [PA.concepto]: "Alícuota IVA (proforma de horas)", [PA.valor]: "21%" });
  // Noviembre 2026 (antes de hoy, para el Empleado). Sin estado = Pendiente.
  const h1 = seedHora(eva, ars, "2026-11-02", "09:00", "09:20"); // vacío
  const h2 = seedHora(eva, ars, "2026-11-03", "10:00", "11:00", { [H.estadoFacturacion]: "Pendiente" });
  const h3 = seedHora(eva, ars, "2026-11-04", "14:00", "16:30", { [H.estadoFacturacion]: "Facturada" });
  const h4 = seedHora(eva, ars, "2026-11-05", "09:00", "09:40", { [H.estadoFacturacion]: "Pagada" });
  const noFact = seedHora(eva, ars, "2026-11-06", "09:00", "10:00", { [H.facturable]: false });
  const hUsd = seedHora(eva, usd, "2026-11-02", "11:00", "12:00", { [H.estadoFacturacion]: "Facturada" });
  ids = { cli, ars, usd, admin, eva, cliUser, h1, h2, h3, h4, noFact, hUsd };
});

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
  const res = await ALL[`/${file}`][method](req, { params: Promise.resolve(opts.params ?? {}) });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return { status: res.status, text, bytes, json: isJson && text ? JSON.parse(text) : null };
}
const writes = () => fake.calls.filter((c) => c.method !== "list");
const row = (id: string) => fake.rows(HT.id).find((r) => r.id === id)!.fields;
const NOV = { desde: "2026-11-01", hasta: "2026-11-30" };
const adminBody = (over: Record<string, unknown> = {}) => ({
  fecha: "2026-11-10",
  proyecto: ids.ars,
  tarea: "QA",
  desde: "09:00",
  hasta: "10:00",
  colaborador: ids.eva,
  facturable: true,
  mesAFacturar: "2026-11",
  ...over,
});

describe("schema y reglas", () => {
  it("campo, opciones y restricción para el Empleado", () => {
    expect(H.estadoFacturacion).toBe("fld3m3N7B9Jz6JCfu");
    expect([...HT.choices.estadoFacturacion]).toEqual(["Pendiente", "Facturada", "Pagada"]);
    expect(RESTRICTED_FIELDS.has(H.estadoFacturacion)).toBe(true);
    expect(HORA_INPUT_KEYS.empleado).not.toContain("estadoFacturacion");
    expect(HORA_INPUT_KEYS.admin).toContain("estadoFacturacion");
  });

  it("vacío o desconocido = Pendiente; textos con plural y singular", () => {
    expect([estadoEfectivo(null), estadoEfectivo(""), estadoEfectivo("Otro"), estadoEfectivo("Pagada")]).toEqual(["Pendiente", "Pendiente", "Pendiente", "Pagada"]);
    expect(ESTADO_MESSAGES.confirmar(3, "Facturada")).toBe("¿Marcar 3 horas como facturadas?");
    expect(ESTADO_MESSAGES.confirmar(2, "Pagada")).toBe("¿Marcar 2 horas como pagadas?");
    expect(ESTADO_MESSAGES.confirmar(1, "Pagada")).toBe("¿Marcar 1 hora como pagada?");
    expect(ESTADO_MESSAGES.hecho(2, "Facturada")).toBe("2 horas marcadas como facturadas.");
    expect(ESTADO_MESSAGES.hecho(1, "Facturada")).toBe("1 hora marcada como facturada.");
  });
});

describe("Admin › Horas", () => {
  beforeEach(() => loginAs(ids.admin));

  it("alta: Pendiente por defecto; con un estado válido, ese; inválido → 400 sin escribir", async () => {
    const a = await call(AD_HORAS, "POST", { body: adminBody() });
    expect(a.status).toBe(201);
    expect(row(a.json.id)[H.estadoFacturacion]).toBe("Pendiente");
    const b = await call(AD_HORAS, "POST", { body: adminBody({ desde: "11:00", hasta: "12:00", estadoFacturacion: "Facturada" }) });
    expect(row(b.json.id)[H.estadoFacturacion]).toBe("Facturada");
    const n = writes().length;
    const c = await call(AD_HORAS, "POST", { body: adminBody({ desde: "13:00", hasta: "14:00", estadoFacturacion: "Cobrada" }) });
    expect(c.status).toBe(400);
    expect(c.json.fieldErrors.estadoFacturacion).toBe(ESTADO_MESSAGES.invalido);
    expect(writes().length).toBe(n);
  });

  it("edición: cualquier dirección (Pagada → Pendiente); sin estado en el body queda el guardado", async () => {
    const body = (over: Record<string, unknown>) => adminBody({ fecha: "2026-11-05", desde: "09:00", hasta: "09:40", ...over });
    expect((await call(AD_HORA, "PATCH", { params: { id: ids.h4 }, body: body({ estadoFacturacion: "Pendiente" }) })).status).toBe(200);
    expect(row(ids.h4)[H.estadoFacturacion]).toBe("Pendiente");
    expect((await call(AD_HORA, "PATCH", { params: { id: ids.h4 }, body: body({ estadoFacturacion: "Pagada" }) })).status).toBe(200);
    expect(row(ids.h4)[H.estadoFacturacion]).toBe("Pagada");
    expect((await call(AD_HORA, "PATCH", { params: { id: ids.h4 }, body: body({ tarea: "Otra" }) })).status).toBe(200);
    expect(row(ids.h4)[H.estadoFacturacion]).toBe("Pagada");
  });

  it("lista: columna con el estado efectivo (vacío → Pendiente) y filtro por estado", async () => {
    const all = await call(AD_HORAS, "GET", { search: NOV });
    const by = Object.fromEntries(all.json.records.map((r: { id: string; estadoFacturacion: string }) => [r.id, r.estadoFacturacion]));
    expect([by[ids.h1], by[ids.h2], by[ids.h3], by[ids.h4]]).toEqual(["Pendiente", "Pendiente", "Facturada", "Pagada"]);
    const f = async (estado: string) => (await call(AD_HORAS, "GET", { search: { ...NOV, estado } })).json.records.map((r: { id: string }) => r.id).sort();
    expect(await f("Pendiente")).toEqual([ids.h1, ids.h2, ids.noFact].sort());
    expect(await f("Facturada")).toEqual([ids.h3, ids.hUsd].sort());
    expect(await f("Pagada")).toEqual([ids.h4]);
    expect((await call(AD_HORAS, "GET", { search: { ...NOV, estado: "Cobrada" } })).status).toBe(400);
  });
});

describe("Empleado › Mis horas", () => {
  beforeEach(() => loginAs(ids.eva));

  it("alta: Pendiente aunque mande otro valor (por clave o por ID de campo)", async () => {
    const res = await call(ME_HORAS, "POST", { body: { fecha: "2026-11-10", proyecto: ids.ars, tarea: "QA", desde: "15:00", hasta: "16:00", estadoFacturacion: "Pagada", [H.estadoFacturacion]: "Pagada" } });
    expect(res.status).toBe(201);
    expect(row(res.json.id)[H.estadoFacturacion]).toBe("Pendiente");
  });

  it("nunca lo lee ni lo devuelve", async () => {
    fake.calls.length = 0;
    const res = await call(ME_HORAS, "GET", { search: NOV });
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/estado|Facturada|Pagada|Pendiente/i);
    for (const c of fake.calls) expect(JSON.stringify(c.options ?? {})).not.toContain(H.estadoFacturacion);
  });
});

describe("Selección › Marcar como facturadas / pagadas (lote)", () => {
  beforeEach(() => loginAs(ids.admin));

  it("camino feliz: solo el campo, todos los IDs", async () => {
    const res = await call(EST, "POST", { body: { ids: [ids.h1, ids.h2], estado: "Facturada" } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, actualizadas: 2, estado: "Facturada" });
    const updates = writes();
    expect(updates.map((c) => c.method)).toEqual(["update"]);
    const payload = updates[0].payload as { id: string; fields: Record<string, unknown> }[];
    expect(payload.map((p) => p.id).sort()).toEqual([ids.h1, ids.h2].sort());
    for (const p of payload) expect(p.fields).toEqual({ [H.estadoFacturacion]: "Facturada" });
    expect([row(ids.h1)[H.estadoFacturacion], row(ids.h2)[H.estadoFacturacion]]).toEqual(["Facturada", "Facturada"]);
    expect((await call(EST, "POST", { body: { ids: [ids.h3], estado: "Pagada" } })).status).toBe(200);
    expect(row(ids.h3)[H.estadoFacturacion]).toBe("Pagada");
  });

  it.each([
    ["proyectos mezclados", () => ({ ids: [ids.h1, ids.hUsd], estado: "Facturada" }), SELECCION_MESSAGES.variosProyectos],
    ["no facturable", () => ({ ids: [ids.h1, ids.noFact], estado: "Facturada" }), SELECCION_MESSAGES.noFacturables],
    ["inexistente", () => ({ ids: [ids.h1, "recNOEXISTE000001"], estado: "Facturada" }), SELECCION_MESSAGES.inexistentes],
    ["más de 500", () => ({ ids: Array.from({ length: 501 }, (_, i) => `rec${String(i).padStart(14, "0")}`), estado: "Facturada" }), SELECCION_MESSAGES.maximo],
    ["vacía", () => ({ ids: [], estado: "Facturada" }), SELECCION_MESSAGES.vacia],
    ["estado inválido", () => ({ ids: [ids.h1], estado: "Cobrada" }), ESTADO_MESSAGES.invalido],
    ["sin estado", () => ({ ids: [ids.h1] }), ESTADO_MESSAGES.invalido],
  ] as const)("%s → 400 sin escribir", async (_l, body, error) => {
    const res = await call(EST, "POST", { body: body() });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe(error);
    expect(writes()).toEqual([]);
  });

  /** 12 horas facturables del proyecto ARS (2 lotes de 10 + 2), con estados mezclados. */
  function doce(): string[] {
    const out: string[] = [];
    for (let i = 0; i < 12; i++) {
      const extra = i % 3 === 0 ? {} : { [H.estadoFacturacion]: i % 3 === 1 ? "Pendiente" : "Pagada" };
      out.push(seedHora(ids.eva, ids.ars, `2026-11-${String(10 + i).padStart(2, "0")}`, "07:00", "07:30", extra));
    }
    return out;
  }

  it("falla un lote → se restauran los valores anteriores (también los vacíos) → 503", async () => {
    const lote = doce();
    const antes = Object.fromEntries(lote.map((id) => [id, row(id)[H.estadoFacturacion]]));
    fake.failWhen((c, i) => c.method === "update" && c.tableId === HT.id && i === 1); // 2.º lote
    const res = await call(EST, "POST", { body: { ids: lote, estado: "Facturada" } });
    expect(res.status).toBe(503);
    expect(res.json.error).toBe("No pudimos completar el cambio. No se modificó nada; probá de nuevo.");
    for (const id of lote) expect(row(id)[H.estadoFacturacion]).toBe(antes[id]);
    expect(lote.some((id) => antes[id] === undefined)).toBe(true);
  });

  it("falla la restauración → 500 y log solo con IDs", async () => {
    const lote = doce();
    fake.failWhen((c, i) => c.method === "update" && c.tableId === HT.id && i >= 1);
    const res = await call(EST, "POST", { body: { ids: lote, estado: "Pagada" } });
    expect(res.status).toBe(500);
    expect(res.json.error).toBe("El cambio quedó incompleto. Avisá a un administrador.");
    const log = vi.mocked(console.error).mock.calls.find((c) => String(c[0]).includes("CAMBIO INCOMPLETO"));
    expect(log).toBeDefined();
    const logged = JSON.stringify(log![1]);
    expect(logged).not.toMatch(/Pagada|Pendiente|Facturada/);
    for (const id of logged.match(/rec[0-9A-Za-z]{14}/g) ?? []) expect(lote).toContain(id);
  });

  it("Empleado y Cliente → 403 sin escribir", async () => {
    for (const who of [ids.eva, ids.cliUser]) {
      await loginAs(who);
      expect((await call(EST, "POST", { body: { ids: [ids.h1], estado: "Pagada" } })).status).toBe(403);
    }
    expect(writes()).toEqual([]);
  });
});

describe("Vista Cliente › Estado", () => {
  beforeEach(() => loginAs(ids.cliUser));
  const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        out.add(k);
        keysOf(x, out);
      }
    }
    return out;
  };

  it("desglose por estado en cada proyecto: horas y netos suman exacto; totales dentro de ±0,01", async () => {
    const res = await call(VISTA, "GET", { search: NOV });
    expect(res.status).toBe(200);
    expect(res.json.estado).toBeNull();
    for (const k of keysOf(res.json)) expect(CLIENTE_RESPONSE_KEYS.has(k)).toBe(true);
    const web = res.json.importes.proyectos.find((p: { codigo: string }) => p.codigo === "QZ - Web");
    expect(web.estados.map((e: { estado: string }) => e.estado)).toEqual(["Pendiente", "Facturada", "Pagada"]);
    const sum = (k: "horas" | "neto" | "total") => web.estados.reduce((n: number, e: Record<string, number>) => n + e[k], 0);
    expect(Math.round(sum("horas") * 100)).toBe(Math.round(web.horas * 100));
    expect(sum("neto")).toBe(web.neto);
    expect(Math.abs(sum("total") - web.total)).toBeLessThanOrEqual(1);
    // Pendiente = h1 (vacío) + h2; mismas reglas de la Proforma.
    const pend = web.estados[0];
    const neto = importeRegistro(0.33, 1234.57) + importeRegistro(1, 1234.57);
    expect(pend).toEqual({ estado: "Pendiente", horas: 1.33, neto, iva: ivaDe(neto, 0.21), total: neto + ivaDe(neto, 0.21) });
  });

  it("filtro por estado: horas, tabla, importes y Excel solo de ese estado", async () => {
    const res = await call(VISTA, "GET", { search: { ...NOV, estado: "Facturada" } });
    expect(res.json.estado).toBe("Facturada");
    // h3 (2,5 h ARS) + hUsd (1 h USD)
    expect(res.json.total).toBe(3.5);
    expect(res.json.rows.map((r: { proyecto: { codigo: string }; total: number }) => [r.proyecto.codigo, r.total])).toEqual([
      ["QZ - App", 1],
      ["QZ - Web", 2.5],
    ]);
    const web = res.json.importes.proyectos.find((p: { codigo: string }) => p.codigo === "QZ - Web");
    expect(web.neto).toBe(importeRegistro(2.5, 1234.57));
    expect(web.estados.map((e: { estado: string }) => e.estado)).toEqual(["Facturada"]);
    const pend = await call(VISTA, "GET", { search: { ...NOV, estado: "Pendiente" } });
    expect(pend.json.total).toBe(1.33);
    expect((await call(VISTA, "GET", { search: { ...NOV, estado: "Pagada" } })).json.total).toBe(0.67);

    const xl = await call(EXCEL, "GET", { search: { ...NOV, estado: "Facturada" } });
    expect(xl.status).toBe(200);
    const rows = readFirstSheet(Buffer.from(xl.bytes));
    expect(rows.some((r) => r[0] === "Estado de facturación: Facturada")).toBe(true);
    expect(rows.some((r) => r[0] === "Estado: Facturada")).toBe(true);
    expect(rows.some((r) => r[0] === "Estado: Pendiente")).toBe(false);
    const total = rows.find((r) => r[0] === "Total");
    expect(total?.at(-1)).toBe(3.5);
  });

  it("filtro inválido → 400", async () => {
    expect((await call(VISTA, "GET", { search: { ...NOV, estado: "Cobrada" } })).status).toBe(400);
  });
});
