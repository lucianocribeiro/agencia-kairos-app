import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { createFakeAirtable } from "./fake-airtable";

/**
 * Selección de horas (Admin › Horas, CC-F4-05) por las rutas reales sobre un Airtable
 * falso: validaciones, importes iguales a la Proforma, «Importe no disponible», alícuota
 * inválida, Excel celda por celda contra la vista de la pantalla, y 403 para Empleado y Cliente.
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
const { calcularProforma, importeRegistro, ivaDe, PROFORMA_MESSAGES } = await import("@/lib/proforma/proforma");
const { recordHours, sumHours } = await import("@/lib/horas/time");
const { SELECCION_MESSAGES, vistaSeleccion, nombreArchivoSeleccion, motivoNoSeleccionable } = await import("@/lib/horas/seleccion");
const { readFirstSheet } = await import("@/lib/xlsx/read");
const { valorExcel } = await import("@/lib/reportes/excel");
const { kindDe } = await import("@/lib/reportes/vista");

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ROUTES = import.meta.glob<Record<string, Handler>>("/app/api/admin/horas/seleccion/**/route.ts", { eager: true });
const SEL = "/app/api/admin/horas/seleccion/route.ts";
const XL = "/app/api/admin/horas/seleccion/excel/route.ts";
const EST = "/app/api/admin/horas/seleccion/estado/route.ts";

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
  const ars = proyecto("QZ - Web ÁRS", { [P.fields.valorHora]: 1234.57, [P.fields.monedaValorHora]: "ARS" });
  const usd = proyecto("QZ - App", { [P.fields.valorHora]: 50, [P.fields.monedaValorHora]: "USD" });
  const sinValor = proyecto("QZ - Sin valor", {});
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
  const admin = user("Ana", "Admin");
  const eva = user("Eva", "Empleado", { [U.proyectosAsignados]: [ars, usd] });
  const otto = user("Otto", "Empleado", { [U.proyectosAsignados]: [ars] });
  const cliUser = user("Carla", "Cliente", { [U.proyectosAsignados]: [ars] });
  fake.seed(TABLES.parametros.id, { [PA.concepto]: "Alícuota IVA (proforma de horas)", [PA.valor]: "21%" });
  // 0,33 h × 1.234,57 = 407,4081 → 407,41 por registro (redondeo por registro, como la Proforma).
  const h1 = seedHora(eva, ars, "2030-03-04", "09:00", "09:20");
  const h2 = seedHora(otto, ars, "2030-03-02", "10:00", "10:20");
  const h3 = seedHora(eva, ars, "2030-04-10", "14:00", "16:30");
  const noFact = seedHora(otto, ars, "2030-03-05", "09:00", "10:00", { [H.facturable]: false });
  const hUsd = seedHora(eva, usd, "2030-03-04", "11:00", "12:00");
  const hSin = seedHora(eva, sinValor, "2030-03-06", "09:00", "10:30");
  ids = { cli, ars, usd, sinValor, admin, eva, otto, cliUser, h1, h2, h3, noFact, hUsd, hSin };
});

async function loginAs(userId: string) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}

async function call(file: string, body: unknown) {
  const cookie = cookieJar.get(SESSION_COOKIE);
  const req = new NextRequest(new URL("http://localhost/api/x"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
  });
  const res = await ROUTES[file].POST(req, { params: Promise.resolve({}) });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return { status: res.status, json: isJson && text ? JSON.parse(text) : null, bytes, headers: res.headers };
}
const writes = () => fake.calls.filter((c) => c.method !== "list");

describe("Selección de horas · resumen (Admin)", () => {
  beforeEach(() => loginAs(ids.admin));

  it("3 horas del proyecto ARS: totales iguales a las funciones de la Proforma para esos registros; sin escribir nada", async () => {
    const res = await call(SEL, { ids: [ids.h3, ids.h1, ids.h2] });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const d = res.json;
    // Proforma del cliente, meses 03 y 04/2030, filtrada a esos 3 registros.
    const horasP = [ids.h1, ids.h2, ids.h3].map((id) => {
      const f = fake.rows(HT.id).find((r) => r.id === id)!.fields;
      return { id, fecha: f[H.fecha] as string, colaborador: (f[H.colaborador] as string[])[0], proyecto: ids.ars, tarea: f[H.tarea] as string, desde: f[H.horaDesde] as number, hasta: f[H.horaHasta] as number, facturable: true, mesAFacturar: f[H.mesAFacturar] as string };
    });
    const proforma = (mes: string) =>
      calcularProforma({
        cliente: { id: ids.cli, nombre: "QA Cliente", sigla: "QZ", cuit: null, condicionIva: null },
        mes,
        alicuota: 0.21,
        proyectos: [{ id: ids.ars, codigo: "QZ - Web ÁRS", cliente: ids.cli, valorHora: 1234.57, moneda: "ARS" }],
        horas: horasP,
        colaboradores: new Map([[ids.eva, "Eva"], [ids.otto, "Otto"]]),
      });
    const detalle = [...proforma("2030-03").detalle, ...proforma("2030-04").detalle];
    const neto = detalle.reduce((n, x) => n + x.importe!, 0);
    expect(d).toMatchObject({
      proyecto: { id: ids.ars, codigo: "QZ - Web ÁRS" },
      valorHora: 1234.57,
      moneda: "ARS",
      registros: 3,
      horas: sumHours(detalle.map((x) => x.horas)),
      neto,
      iva: ivaDe(neto, 0.21),
      total: neto + ivaDe(neto, 0.21),
      desde: "2030-03-02",
      hasta: "2030-04-10",
    });
    // Redondeo por registro: 0,33 h × 1.234,57 → 407,41 (no horas totales × valor hora).
    expect(d.detalle.map((x: { importe: number }) => x.importe)).toEqual([40741, 40741, importeRegistro(2.5, 1234.57)]);
    expect(d.neto).toBe(40741 * 2 + 308643);
    expect(d.neto).not.toBe(Math.round(d.horas * 1234.57 * 100));
    // Ordenado por Fecha, con el nombre del colaborador.
    expect(d.detalle.map((x: { fecha: string; colaborador: string }) => `${x.fecha} ${x.colaborador}`)).toEqual(["2030-03-02 Otto", "2030-03-04 Eva", "2030-04-10 Eva"]);
    expect(d.horas).toBe(sumHours([recordHours(t("09:00"), t("09:20")), recordHours(t("10:00"), t("10:20")), 2.5]));
    expect(writes()).toEqual([]);
  });

  it.each([
    ["mezcla de proyectos", () => [ids.h1, ids.hUsd], SELECCION_MESSAGES.variosProyectos],
    ["horas no facturables", () => [ids.h1, ids.noFact], SELECCION_MESSAGES.noFacturables],
    ["un ID que no existe", () => [ids.h1, "recNOEXISTE000001"], SELECCION_MESSAGES.inexistentes],
    ["un ID mal formado", () => [ids.h1, "no-es-id"], SELECCION_MESSAGES.inexistentes],
    ["nada", () => [], SELECCION_MESSAGES.vacia],
  ])("%s → 400 con el mensaje", async (_l, sel, msg) => {
    const res = await call(SEL, { ids: sel() });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: msg });
    expect((await call(XL, { ids: sel() })).json).toEqual({ error: msg });
  });

  it("más de 500 → 400 «Seleccioná hasta 500 registros.»; 500 se aceptan", async () => {
    const muchos = Array.from({ length: 501 }, (_, i) => `rec${String(i).padStart(14, "0")}`);
    expect((await call(SEL, { ids: muchos })).json).toEqual({ error: "Seleccioná hasta 500 registros." });
    expect((await call(SEL, { ids: muchos.slice(0, 500) })).json).toEqual({ error: SELECCION_MESSAGES.inexistentes });
    // 500 IDs se leen en lotes de 100.
    expect(fake.calls.filter((c) => c.method === "list" && c.tableId === HT.id)).toHaveLength(5);
  });

  it("body sin ids o que no es JSON → 400/415", async () => {
    expect((await call(SEL, {})).status).toBe(400);
    expect((await call(SEL, { ids: "rec" })).status).toBe(400);
  });

  it("proyecto sin valor hora ni moneda: horas sí, importes «Importe no disponible»", async () => {
    const res = await call(SEL, { ids: [ids.hSin] });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ valorHora: null, moneda: null, horas: 1.5, neto: null, iva: null, total: null });
    const vista = vistaSeleccion(res.json);
    expect(vista.tablas[1].filas[0].cells[4]).toBe("Importe no disponible");
    expect(vista.tablas[2].filas[0].cells).toEqual([1.5, "Importe no disponible", null, null]);
  });

  it("alícuota inválida → 409 con el mensaje de la Proforma (también el Excel)", async () => {
    fake.rows(TABLES.parametros.id)[0].fields[PA.valor] = "mucho";
    expect(await call(SEL, { ids: [ids.h1] }).then((r) => [r.status, r.json])).toEqual([409, { error: PROFORMA_MESSAGES.alicuota }]);
    expect((await call(XL, { ids: [ids.h1] })).status).toBe(409);
  });

  it("valores del cliente se ignoran: solo cuentan los IDs (se relee todo)", async () => {
    const res = await call(SEL, { ids: [ids.h1], valorHora: 1, moneda: "USD", horas: 99 });
    expect(res.json).toMatchObject({ valorHora: 1234.57, moneda: "ARS", horas: 0.33, neto: 40741 });
  });
});

describe("Selección de horas · Excel", () => {
  beforeEach(() => loginAs(ids.admin));

  it("celda por celda igual a la vista de la pantalla; nombre del archivo", async () => {
    const sel = { ids: [ids.h1, ids.h2, ids.h3] };
    const screen = (await call(SEL, sel)).json;
    const xl = await call(XL, sel);
    expect(xl.status).toBe(200);
    expect(xl.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(xl.headers.get("cache-control")).toBe("no-store");
    expect(xl.headers.get("content-disposition")).toBe('attachment; filename="Seleccion_QZ-Web-ARS_2030-03-02_2030-04-10.xlsx"');
    expect(nombreArchivoSeleccion(screen)).toBe("Seleccion_QZ-Web-ARS_2030-03-02_2030-04-10.xlsx");

    const trim = (r: unknown[]) => {
      const out = [...r];
      while (out.length && (out[out.length - 1] === null || out[out.length - 1] === undefined)) out.pop();
      return out;
    };
    const rows = readFirstSheet(xl.bytes).map(trim);
    // Hoja esperada armada a mano desde el objeto de la pantalla.
    const m = (c: number) => c / 100;
    const expected = [
      ["Selección de horas"],
      ["Período: 02/03/2030 al 10/04/2030"],
      [],
      ["Proyecto"],
      ["Proyecto", "Valor hora", "Moneda"],
      ["QZ - Web ÁRS", 1234.57, "ARS"],
      [],
      ["Detalle"],
      ["Fecha", "Colaborador", "Tarea", "Horas", "Importe"],
      ...screen.detalle.map((f: { fecha: string; colaborador: string; tarea: string; horas: number; importe: number }) => [
        `${f.fecha.slice(8)}/${f.fecha.slice(5, 7)}/${f.fecha.slice(0, 4)}`,
        f.colaborador,
        f.tarea,
        f.horas,
        m(f.importe),
      ]),
      [],
      ["Totales"],
      ["Horas", "Neto", "IVA", "Total"],
      [screen.horas, m(screen.neto), m(screen.iva), m(screen.total)],
    ];
    expect(rows).toEqual(expected.map(trim));
    expect(rows[9]).toEqual(["02/03/2030", "Otto", "Tarea 2030-03-02 10:00", 0.33, 407.41]);
    // y coincide con la vista que se dibuja
    const vista = vistaSeleccion(screen);
    for (const tb of vista.tablas) for (const f of tb.filas) expect(rows).toContainEqual(trim(tb.columnas.map((c, i) => valorExcel(kindDe(c, f), f.cells[i] ?? null))));
  });
});

describe("Selección de horas · permisos", () => {
  it("Empleado y Cliente → 403 en las 3 rutas (+ estado, CC-F4-08), sin leer Horas; sin sesión → 401", async () => {
    expect(Object.keys(ROUTES).sort()).toEqual([EST, XL, SEL]);
    for (const who of [ids.eva, ids.cliUser]) {
      await loginAs(who);
      for (const file of [SEL, XL, EST]) {
        const res = await call(file, { ids: [ids.h1], estado: "Facturada" });
        expect(res.status, `${who} ${file}`).toBe(403);
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
    }
    expect(fake.calls.some((c) => c.tableId === HT.id)).toBe(false);
    cookieJar.clear();
    expect((await call(SEL, { ids: [ids.h1] })).status).toBe(401);
    expect((await call(EST, { ids: [ids.h1], estado: "Facturada" })).status).toBe(401);
  });
});

describe("Selección de horas · reglas de la fila", () => {
  it("solo Facturables con proyecto; con algo elegido, solo del mismo proyecto", () => {
    expect(motivoNoSeleccionable({ facturable: false, proyecto: { id: "a" } }, null)).toBe("Sólo se pueden seleccionar horas facturables.");
    expect(motivoNoSeleccionable({ facturable: true, proyecto: null }, null)).toBe(SELECCION_MESSAGES.sinProyecto);
    expect(motivoNoSeleccionable({ facturable: true, proyecto: { id: "a" } }, null)).toBeNull();
    expect(motivoNoSeleccionable({ facturable: true, proyecto: { id: "b" } }, "a")).toBe("Sólo podés seleccionar horas de un mismo proyecto.");
  });
});
