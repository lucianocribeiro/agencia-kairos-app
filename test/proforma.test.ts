import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { formatNumber, isoToDisplayDate } from "@/lib/format";
import { formatHours } from "@/lib/horas/time";
import { createFakeAirtable } from "./fake-airtable";
import { pdfText } from "./pdf-text";

/** Proforma de punta a punta (rutas + servicio + PDF + Airtable falso). Datos sintéticos. */
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
const jsonRoute = await import("@/app/api/admin/proforma/route");
const pdfRoute = await import("@/app/api/admin/proforma/pdf/route");
const { ProformaPage } = await import("@/components/proforma/server/proforma-page");
const { horasDelMesFormula, HORA_FIELDS, PROYECTO_FIELDS } = await import("@/lib/proforma/server/service");
type ProformaData = import("@/lib/proforma/proforma").ProformaData;

const T = TABLES;
const U = T.usuarios.fields;
const Hf = T.horas.fields;
const P = T.proyectos.fields;
const CL = T.clientes.fields;

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("clave-de-prueba", 4);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-14T15:00:00Z") });
});
afterAll(() => vi.useRealTimers());

let ids: Record<string, string>;
const t = (hhmm: string) => Number(hhmm.slice(0, 2)) * 3600 + Number(hhmm.slice(3)) * 60;
beforeEach(() => {
  fake.reset();
  cookieJar.clear();
  clearUserCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const user = (nombre: string, email: string, rol: string) =>
    fake.seed(T.usuarios.id, { [U.nombre]: nombre, [U.email]: email, [U.rol]: rol, [U.sigla]: email.slice(0, 2).toUpperCase(), [U.estado]: "Activo", [U.debeCambiarPassword]: false, [U.passwordHash]: hash });
  const admin = user("Ana Admin", "ana@kairos.test", "Admin");
  const empleado = user("Beto Empleado", "beto@kairos.test", "Empleado");
  const cliente = fake.seed(T.clientes.id, { [CL.nombre]: "QA Cliente Uno", [CL.sigla]: "QA", [CL.estado]: "Activo", [CL.cuit]: "30711111118", [CL.condicionIva]: "Responsable Inscripto" });
  const inactivo = fake.seed(T.clientes.id, { [CL.nombre]: "QA Cliente Inactivo", [CL.sigla]: "QI", [CL.estado]: "Inactivo" });
  const otro = fake.seed(T.clientes.id, { [CL.nombre]: "QA Cliente Otro", [CL.sigla]: "QO", [CL.estado]: "Activo" });
  const web = fake.seed(T.proyectos.id, { [P.codigo]: "QA - Web", [P.cliente]: [cliente], [P.valorHora]: 1234.57, [P.monedaValorHora]: "ARS", [P.estado]: "Activo" });
  const sop = fake.seed(T.proyectos.id, { [P.codigo]: "QA - Soporte", [P.cliente]: [cliente], [P.valorHora]: 50, [P.monedaValorHora]: "USD", [P.estado]: "Activo" });
  const sin = fake.seed(T.proyectos.id, { [P.codigo]: "QA - Sin valor", [P.cliente]: [cliente], [P.estado]: "Activo" });
  const ajeno = fake.seed(T.proyectos.id, { [P.codigo]: "QO - Ajeno", [P.cliente]: [otro], [P.valorHora]: 999, [P.monedaValorHora]: "ARS", [P.estado]: "Activo" });
  const PA = T.parametros.fields;
  fake.seed(T.parametros.id, { [PA.concepto]: "Alícuota IVA (proforma de horas)", [PA.valor]: "0.21" });
  const hora = (proyecto: string, fecha: string, desde: string, hasta: string, extra: Record<string, unknown> = {}) =>
    fake.seed(T.horas.id, { [Hf.fecha]: fecha, [Hf.proyecto]: [proyecto], [Hf.colaborador]: [admin], [Hf.tarea]: `Tarea ${fecha} ${desde}`, [Hf.horaDesde]: t(desde), [Hf.horaHasta]: t(hasta), [Hf.facturable]: true, ...extra });
  hora(web, "2026-10-05", "09:00", "09:20");
  hora(web, "2026-10-05", "10:00", "10:20");
  hora(web, "2026-10-06", "09:00", "09:20");
  hora(web, "2026-10-07", "09:00", "10:00", { [Hf.facturable]: false });
  hora(web, "2026-09-30", "08:00", "09:30", { [Hf.mesAFacturar]: "2026-10-01" });
  hora(web, "2026-10-31", "09:00", "10:00", { [Hf.mesAFacturar]: "2026-11-01" });
  hora(sop, "2026-10-10", "14:00", "16:30", { [Hf.colaborador]: [empleado] });
  hora(sin, "2026-10-12", "09:00", "10:00");
  hora(ajeno, "2026-10-05", "09:00", "10:00");
  ids = { admin, empleado, cliente, inactivo, otro };
});

async function loginAs(userId: string) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}
const req = (url: string) => {
  const cookie = cookieJar.get(SESSION_COOKIE);
  return new NextRequest(`http://localhost${url}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });
};
async function getJson(q: string) {
  const res = await jsonRoute.GET(req(`/api/admin/proforma${q}`), {});
  return { status: res.status, json: await res.json(), cc: res.headers.get("cache-control") };
}
async function getPdf(q: string) {
  const res = await pdfRoute.GET(req(`/api/admin/proforma/pdf${q}`), {});
  return { status: res.status, headers: res.headers, cc: res.headers.get("cache-control"), bytes: new Uint8Array(await res.arrayBuffer()) };
}
const money = (cents: number) => formatNumber(cents / 100, { decimals: 2 });

describe("proforma · Admin", () => {
  beforeEach(() => loginAs(ids.admin));

  it("JSON: totales por moneda, proyecto sin valor hora, otro cliente y no facturables afuera", async () => {
    const { status, json, cc } = await getJson(`?cliente=${ids.cliente}&mes=2026-10`);
    expect([status, cc]).toEqual([200, "no-store"]);
    const d = json as ProformaData;
    expect(d.cliente).toMatchObject({ nombre: "QA Cliente Uno", cuit: "30-71111111-8", condicionIva: "Responsable Inscripto" });
    expect(d.proyectos.map((p) => [p.codigo, p.horas, p.importe])).toEqual([
      ["QA - Sin valor", 1, null],
      ["QA - Soporte", 2.5, 12500],
      ["QA - Web", 2.49, 122223 + 185186],
    ]);
    expect(d.totales).toEqual([
      { moneda: "ARS", subtotal: 307409, iva: 64556, total: 371965 }, // IVA = ROUND(3.074,09 × 0,21) = 645,56
      { moneda: "USD", subtotal: 12500, iva: 2625, total: 15125 },
    ]);
    expect(d.detalle.map((r) => r.colaborador)).toEqual(["Ana Admin", "Ana Admin", "Ana Admin", "Ana Admin", "Beto Empleado", "Ana Admin"]);
    expect(d.incompleta).toBe(true);
  });

  it("lee solo los campos que usa y filtra Horas en Airtable por el mes", async () => {
    await getJson(`?cliente=${ids.cliente}&mes=2026-10`);
    const horas = fake.calls.find((c) => c.method === "list" && c.tableId === T.horas.id)!.options as { fields: string[]; filterByFormula: { toString(): string } };
    expect(horas.fields).toEqual(HORA_FIELDS);
    expect(String(horas.filterByFormula)).toBe(String(horasDelMesFormula("2026-10")));
    expect(String(horasDelMesFormula("2026-10"))).toBe(
      `OR(AND({${Hf.mesAFacturar}}, IS_AFTER({${Hf.mesAFacturar}}, "2026-09-30"), IS_BEFORE({${Hf.mesAFacturar}}, "2026-11-01")), AND(NOT({${Hf.mesAFacturar}}), AND({${Hf.fecha}}, IS_AFTER({${Hf.fecha}}, "2026-09-30"), IS_BEFORE({${Hf.fecha}}, "2026-11-01"))))`,
    );
    const proyectos = fake.calls.find((c) => c.method === "list" && c.tableId === T.proyectos.id)!.options as { fields: string[] };
    expect(proyectos.fields).toEqual(PROYECTO_FIELDS);
    const usuarios = fake.calls.filter((c) => c.method === "list" && c.tableId === T.usuarios.id).map((c) => (c.options as { fields: string[] }).fields);
    expect(usuarios).toContainEqual([U.nombre]);
  });

  it("PDF: Content-Type, nombre del archivo, no-store; el texto tiene encabezado, proyectos, totales y detalle en es-AR", async () => {
    const { json } = await getJson(`?cliente=${ids.cliente}&mes=2026-10`);
    const d = json as ProformaData;
    const r = await getPdf(`?cliente=${ids.cliente}&mes=2026-10`);
    expect(r.status).toBe(200);
    expect(r.cc).toBe("no-store");
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toBe(`attachment; filename="Proforma_QA_202610.pdf"; filename*=UTF-8''Proforma_QA_202610.pdf`);
    const { pages } = await pdfText(r.bytes);
    const all = pages.flat().join("\n");
    const plano = pages.flat().join(" ").replace(/\s+/g, " "); // textos que cortan línea dentro de su celda
    for (const s of ["Proforma de horas", "QA Cliente Uno", "30-71111111-8", "Responsable Inscripto", "10/2026", "IVA 21 %", "Falta valor hora o moneda en el proyecto", "La proforma está incompleta"]) expect(plano, s).toContain(s);
    for (const p of d.proyectos) expect(all).toContain([p.codigo, formatHours(p.horas), ...(p.valorHora !== null ? [formatNumber(p.valorHora, { decimals: 2 }), p.moneda!, money(p.importe!)] : [])].join("   "));
    for (const tt of d.totales) expect(all).toContain([tt.moneda, money(tt.subtotal), money(tt.iva), money(tt.total)].join("   "));
    for (const row of d.detalle) {
      const line = pages.flat().find((l) => l.startsWith(isoToDisplayDate(row.fecha)) && l.includes(row.tarea.slice(0, 10)) && l.includes(formatHours(row.horas)));
      expect(line, row.tarea).toBeTruthy();
      if (row.importe !== null) expect(line).toContain(money(row.importe));
    }
    expect(all).toContain("Página 1 de 1");
    expect(all).toMatch(/Generado el \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  });

  it("página: sin cliente solo los selectores (clientes Activos por nombre); con cliente, los datos", async () => {
    const vacia = renderToStaticMarkup(await ProformaPage({ searchParams: Promise.resolve({}) }));
    expect(vacia).toContain("Elegí un cliente");
    expect(vacia).toContain("QA Cliente Otro");
    expect(vacia).not.toContain("QA Cliente Inactivo");
    expect(vacia.indexOf("QA Cliente Otro")).toBeLessThan(vacia.indexOf("QA Cliente Uno"));
    expect(vacia).not.toContain("Resumen por proyecto");
    expect(vacia).toContain('value="2026-11"'); // mes actual por defecto
    const html = renderToStaticMarkup(await ProformaPage({ searchParams: Promise.resolve({ cliente: ids.cliente, mes: "2026-10" }) }));
    for (const s of ["Resumen por proyecto", "30-71111111-8", "3.719,65", "151,25", "Descargar PDF", `/api/admin/proforma/pdf?cliente=${ids.cliente}&amp;mes=2026-10`]) expect(html, s).toContain(s);
    const sinHoras = renderToStaticMarkup(await ProformaPage({ searchParams: Promise.resolve({ cliente: ids.cliente, mes: "2026-08" }) }));
    expect(sinHoras).toContain("No hay horas facturables de este cliente en 08/2026.");
    expect(sinHoras).not.toContain("Descargar PDF");
    const malo = renderToStaticMarkup(await ProformaPage({ searchParams: Promise.resolve({ cliente: ids.cliente, mes: "2026-13" }) }));
    expect(malo).toContain("Elegí un mes válido (AAAA-MM).");
  });

  it("errores: mes inválido, cliente mal formado / inexistente / Inactivo, sin cliente, alícuota inválida, mes sin horas", async () => {
    const both = async (q: string) => [await getJson(q), await getPdf(q)].map((r) => [r.status, r.cc]);
    expect(await both(`?cliente=${ids.cliente}&mes=2026-13`)).toEqual([[400, "no-store"], [400, "no-store"]]);
    expect(await both(`?cliente=${ids.cliente}&mes=2100-01`)).toEqual([[400, "no-store"], [400, "no-store"]]);
    expect(await both(`?cliente=${ids.cliente}&mes=1999-12`)).toEqual([[400, "no-store"], [400, "no-store"]]);
    expect(await both(`?cliente=nada&mes=2026-10`)).toEqual([[400, "no-store"], [400, "no-store"]]);
    expect(await both(`?cliente=recNOEXISTE000000&mes=2026-10`)).toEqual([[404, "no-store"], [404, "no-store"]]);
    expect(await both(`?cliente=${ids.inactivo}&mes=2026-10`)).toEqual([[400, "no-store"], [400, "no-store"]]);
    expect(await both(`?mes=2026-10`)).toEqual([[400, "no-store"], [400, "no-store"]]);
    expect((await getJson(`?cliente=${ids.cliente}&mes=2026-13`)).json).toEqual({ error: "Elegí un mes válido (AAAA-MM)." });
    expect((await getJson(`?cliente=${ids.inactivo}&mes=2026-10`)).json).toEqual({ error: "El cliente no está Activo. Elegí un cliente Activo." });
    // mes sin horas: la vista dice que no hay; el PDF no se genera
    const vacia = await getJson(`?cliente=${ids.cliente}&mes=2026-08`);
    expect([vacia.status, vacia.json.vacia]).toEqual([200, true]);
    const sinPdf = await getPdf(`?cliente=${ids.cliente}&mes=2026-08`);
    expect([sinPdf.status, sinPdf.cc]).toEqual([404, "no-store"]);
    // alícuota inválida: bloquea pantalla y PDF
    const param = fake.rows(T.parametros.id)[0];
    for (const bad of ["veintiuno", "", "150"]) {
      param.fields[T.parametros.fields.valor] = bad;
      expect(await both(`?cliente=${ids.cliente}&mes=2026-10`), bad).toEqual([[409, "no-store"], [409, "no-store"]]);
    }
    expect((await getJson(`?cliente=${ids.cliente}&mes=2026-10`)).json).toEqual({ error: "Revisá el parámetro Alícuota IVA (proforma de horas) en Maestros." });
    param.fields[T.parametros.fields.valor] = "21%";
    expect((await getJson(`?cliente=${ids.cliente}&mes=2026-10`)).json.alicuota).toBe(0.21);
    // error no controlado → 500, también no-store
    fake.fail("list", T.horas.id);
    expect(await both(`?cliente=${ids.cliente}&mes=2026-10`)).toEqual([[500, "no-store"], [500, "no-store"]]);
  });
});

describe("proforma · tipo de cambio (CC-F5-22)", () => {
  beforeEach(() => loginAs(ids.admin));
  // ARS 3.074,09 + USD 125,00 × 1.050,25 = 131.281,25 → neto 134.355,34; IVA 21 % = 28.214,6214 → 28.214,62.
  const conversion = { tipoCambio: 1050.25, subtotalArs: 307409, subtotalUsd: 12500, netoArsDesdeUsd: 13128125, neto: 13435534, iva: 2821462, total: 16256996, mixta: true };

  it("JSON: tc válido → 200 con la conversión; tc inválido → 400 con el mensaje (no-store); sin tc → sin conversión", async () => {
    const { TC_MESSAGES } = await import("@/lib/proforma/tipo-cambio");
    const ok = await getJson(`?cliente=${ids.cliente}&mes=2026-10&tc=${encodeURIComponent("1.050,25")}`);
    expect(ok.status).toBe(200);
    expect((ok.json as ProformaData).conversion).toEqual(conversion);
    for (const bad of ["1000,00001", "999999,99999", "1e3", "-0", "１２３", "1 000"]) {
      const r = await getJson(`?cliente=${ids.cliente}&mes=2026-10&tc=${encodeURIComponent(bad)}`);
      expect([r.status, r.json.error, r.cc]).toEqual([400, TC_MESSAGES.invalido, "no-store"]);
    }
    const sin = await getJson(`?cliente=${ids.cliente}&mes=2026-10`);
    expect(sin.status).toBe(200);
    expect("conversion" in sin.json).toBe(false);
  });

  it("página: tc inválido → el mensaje junto al campo y sin conversión; tc válido → «Equivalente en pesos»", async () => {
    const { TC_MESSAGES } = await import("@/lib/proforma/tipo-cambio");
    const mala = renderToStaticMarkup(await ProformaPage({ searchParams: Promise.resolve({ cliente: ids.cliente, mes: "2026-10", tc: "1000,00001" }) }));
    expect(mala).toContain(TC_MESSAGES.invalido);
    expect(mala).toContain('aria-invalid="true"');
    expect(mala).not.toContain("Equivalente en pesos");
    expect(mala).not.toContain("Tipo de cambio:");
    expect(mala).toContain("QA - Soporte"); // la proforma se muestra igual
    const buena = renderToStaticMarkup(await ProformaPage({ searchParams: Promise.resolve({ cliente: ids.cliente, mes: "2026-10", tc: "1.050,25" }) }));
    expect(buena).toContain("Equivalente en pesos");
    expect(buena).toContain("Tipo de cambio: 1.050,25");
    expect(buena).toContain("162.569,96");
    expect(buena).not.toContain(TC_MESSAGES.invalido);
  });
});

describe("proforma · Empleado y sin sesión", () => {
  it("Empleado: 403 en la API y en el PDF, sin leer Horas ni Proyectos; sin sesión: 401", async () => {
    await loginAs(ids.empleado);
    fake.calls.length = 0;
    for (const r of [await getJson(`?cliente=${ids.cliente}&mes=2026-10`), await getPdf(`?cliente=${ids.cliente}&mes=2026-10`)]) expect([r.status, r.cc]).toEqual([403, "no-store"]);
    expect(fake.calls.filter((c) => c.tableId !== T.usuarios.id)).toEqual([]);
    cookieJar.clear();
    for (const r of [await getJson(`?cliente=${ids.cliente}`), await getPdf(`?cliente=${ids.cliente}`)]) expect([r.status, r.cc]).toEqual([401, "no-store"]);
  });
});
