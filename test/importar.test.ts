import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { arcaXlsx, cuitSintetico, factura, type FilaArca } from "./arca-fixture";
import { createFakeAirtable } from "./fake-airtable";

/**
 * Importación ARCA de punta a punta (rutas + servicio + Airtable falso). Archivos
 * sintéticos generados en el test; nada real.
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
const preview = await import("@/app/api/admin/importar/[tabla]/preview/route");
const confirmar = await import("@/app/api/admin/importar/[tabla]/confirmar/route");
const { MAX_FILE_BYTES } = await import("@/lib/ventas-compras/server/upload");
const { MENSAJES } = await import("@/lib/ventas-compras/rules");
expect(MENSAJES.sinCliente).toBe("Cliente sin identificar");

const T = TABLES;
const V = T.ventas.fields;
const C = T.compras.fields;
const U = T.usuarios.fields;

const CUIT_CLIENTE = cuitSintetico("30", 11111111);
const CUIT_OTRO = cuitSintetico("30", 22222222);
const CUIT_PROV_EXISTE = cuitSintetico("30", 33333333);
const CUIT_PROV_NUEVO = cuitSintetico("27", 44444444);

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("clave-de-prueba", 4);
});

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
  const un2 = fake.seed(T.unidadesNegocio.id, { [T.unidadesNegocio.fields.nombre]: "Software" });
  const cliente = fake.seed(T.clientes.id, { [T.clientes.fields.nombre]: "QA Cliente", [T.clientes.fields.sigla]: "QA", [T.clientes.fields.estado]: "Activo", [T.clientes.fields.cuit]: CUIT_CLIENTE });
  const otroCliente = fake.seed(T.clientes.id, { [T.clientes.fields.nombre]: "Otro", [T.clientes.fields.sigla]: "OT", [T.clientes.fields.estado]: "Activo" });
  const gastoDefault = cat("Gastos varios", "Gasto");
  ids = {
    admin: user("ana@kairos.test", "Admin"),
    empleado: user("eva@kairos.test", "Empleado"),
    factC: tipo(11, 1),
    ncC: tipo(13, -1),
    factA: tipo(1, 1),
    un,
    un2,
    cliente,
    otroCliente,
    ingresoRP: cat("Ingresos por servicios", "Ingreso", true),
    ingreso: cat("Otros ingresos", "Ingreso"),
    gastoRP: cat("Honorarios (proyectos)", "Gasto", true),
    gastoDefault,
    proyecto: fake.seed(T.proyectos.id, { [T.proyectos.fields.codigo]: "OT - Web", [T.proyectos.fields.estado]: "Activo", [T.proyectos.fields.cliente]: [otroCliente], [T.proyectos.fields.unidadNegocio]: [un] }),
    cerrado: fake.seed(T.proyectos.id, { [T.proyectos.fields.codigo]: "OT - Viejo", [T.proyectos.fields.estado]: "Cerrado", [T.proyectos.fields.cliente]: [otroCliente] }),
    socio: fake.seed(T.socios.id, { [T.socios.fields.sigla]: "LR", [T.socios.fields.nombre]: "Luciano" }),
    proveedor: fake.seed(T.proveedores.id, { [T.proveedores.fields.nombre]: "QA Proveedor existente", [T.proveedores.fields.cuit]: CUIT_PROV_EXISTE, [T.proveedores.fields.categoriaPorDefecto]: [gastoDefault] }),
  };
  fake.seed(T.parametros.id, { [T.parametros.fields.concepto]: "Categoría por defecto en Ventas", [T.parametros.fields.valor]: "Ingresos por servicios" });
});
afterEach(() => vi.unstubAllEnvs());

async function loginAs(userId: string) {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId, pf: passwordFingerprint(hash) }, SECRET));
}

type Route = { POST: (req: NextRequest, ctx: { params: Promise<{ tabla: string }> }) => Promise<Response> };
async function send(route: Route, tabla: string, file: Buffer | null, opts: { ediciones?: unknown; name?: string; headers?: Record<string, string>; rawEdiciones?: string } = {}) {
  const fd = new FormData();
  if (file) fd.append("archivo", new File([new Uint8Array(file)], opts.name ?? "arca.xlsx"));
  if (opts.ediciones !== undefined) fd.append("ediciones", JSON.stringify(opts.ediciones));
  if (opts.rawEdiciones !== undefined) fd.append("ediciones", opts.rawEdiciones);
  const cookie = cookieJar.get(SESSION_COOKIE);
  const req = new NextRequest(`http://localhost/api/admin/importar/${tabla}/x`, {
    method: "POST",
    body: fd,
    headers: { ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}), ...opts.headers },
  });
  const res = await route.POST(req, { params: Promise.resolve({ tabla }) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const prev = (tabla: string, file: Buffer | null, opts?: Parameters<typeof send>[3]) => send(preview, tabla, file, opts);
const conf = (tabla: string, file: Buffer | null, opts?: Parameters<typeof send>[3]) => send(confirmar, tabla, file, opts);

type Fila = { fila: number; clave: string | null; estado: string; error: string | null; importes: { total: number; iva: number; neto: number } };

/** Archivo de Ventas del smoke: Factura C, NC, USD con TC, USD sin TC, tipo desconocido, cliente por CUIT, sin match. */
function ventasFile(extra: FilaArca[] = []) {
  return arcaXlsx("ventas", [
    factura({ numeroDesde: 1, numeroHasta: 1, nroDocReceptor: CUIT_CLIENTE, impTotal: 1000 }),
    factura({ tipo: "13 - Nota de Crédito C", numeroDesde: 2, numeroHasta: 2, nroDocReceptor: CUIT_CLIENTE, impTotal: "605,50", totalIva: "105,50" }),
    factura({ tipo: "1 - Factura A", numeroDesde: 3, numeroHasta: 3, nroDocReceptor: CUIT_OTRO, moneda: "DOL", tipoCambio: "1.000,5", impTotal: 100.01, totalIva: 17.36, otrosTributos: 0.5 }),
    factura({ tipo: "1 - Factura A", numeroDesde: 4, nroDocReceptor: CUIT_OTRO, moneda: "DOL", tipoCambio: null, impTotal: 50 }),
    factura({ tipo: "99 - Inventado", numeroDesde: 5, nroDocReceptor: CUIT_OTRO }),
    factura({ numeroDesde: 6, fecha: 46310, nroDocReceptor: "30-" + CUIT_OTRO.slice(2, 10) + "-" + CUIT_OTRO[10] }),
    ...extra,
  ]);
}

describe("parser (por la ruta de vista previa)", () => {
  beforeEach(() => loginAs(ids.admin));

  it("encuentra los encabezados debajo de un título, con mayúsculas, sin tildes, espacios y saltos de línea", async () => {
    for (const opts of [{}, { encabezadosRaros: true }, { encabezadosRaros: true, sharedStrings: true }, { titulo: null }]) {
      const res = await prev("ventas", arcaXlsx("ventas", [factura()], opts));
      expect(res.status, JSON.stringify(opts)).toBe(200);
      expect(res.json.filas).toHaveLength(1);
      expect(res.json.filas[0].fila).toBe(opts.titulo === null ? 2 : 4);
    }
  });

  it("columna faltante → error que la nombra y nada importado", async () => {
    const res = await prev("ventas", arcaXlsx("ventas", [factura()], { sinColumnas: ["otrosTributos", "codAutorizacion"] }));
    expect(res).toEqual({ status: 400, json: { error: "Faltan las columnas «Cód. Autorización», «Otros Tributos». No se importó nada." } });
    const one = await conf("compras", arcaXlsx("compras", [factura()], { sinColumnas: ["nroDocReceptor"] }));
    expect(one).toEqual({ status: 400, json: { error: "Falta la columna «Nro. Doc. Receptor». No se importó nada." } });
    expect(fake.calls.some((c) => c.method === "create")).toBe(false);
  });

  it("archivo equivocado: Emitidos en Compras y Recibidos en Ventas", async () => {
    expect((await prev("compras", arcaXlsx("ventas", [factura()]))).json.error).toMatch(/Mis Comprobantes Emitidos.*Ventas › Importar/);
    expect((await prev("ventas", arcaXlsx("compras", [factura()]))).json.error).toMatch(/Mis Comprobantes Recibidos.*Compras › Importar/);
  });

  it("sin encabezados, sin filas, demasiadas filas", async () => {
    const { buildXlsx } = await import("./xlsx-fixture");
    expect((await prev("ventas", buildXlsx([["hola"], ["chau"]]))).json.error).toMatch(/No encontramos los encabezados/);
    expect((await prev("ventas", arcaXlsx("ventas", []))).json.error).toBe("El archivo no tiene comprobantes.");
    const many = Array.from({ length: 1001 }, (_, i) => factura({ numeroDesde: i + 1 }));
    expect((await prev("ventas", arcaXlsx("ventas", many))).json.error).toMatch(/1001 comprobantes; el máximo/);
  });

  it("números en texto es-AR, fechas en texto y como número de Excel", async () => {
    const res = await prev("ventas", ventasFile());
    const [f1, f2, f3, , , f6] = res.json.filas as (Fila & { datos: Record<string, unknown> })[];
    expect(f1.datos.fecha).toBe("2026-10-15");
    expect(f6.datos.fecha).toBe("2026-10-15");
    expect(f2.datos.impTotal).toBe(605.5);
    expect(f3.datos.tipoCambio).toBe(1000.5);
    const bad = await prev(
      "ventas",
      arcaXlsx("ventas", [
        factura({ impTotal: "12abc" }),
        factura({ numeroDesde: 9, fecha: "31/02/2026" }),
        factura({ numeroDesde: 10, fecha: 60 }), // 29/02/1900 falso de Excel
        factura({ numeroDesde: 11, impTotal: 1e300, tipoCambio: 1e10 }),
        factura({ numeroDesde: 12, fecha: 61 }),
      ]),
    );
    expect(bad.status).toBe(200);
    expect(bad.json.filas.map((f: Fila) => f.error)).toEqual(["Número inválido en «Imp. Total»", "Fecha inválida", "Fecha inválida", "Número fuera de rango en «Imp. Total»", null]);
    expect(bad.json.filas[4].datos.fecha).toBe("1900-03-01");
  });
});

describe("archivo malformado → 400 sin escribir nada (fixes 1, 2, 4)", () => {
  beforeEach(() => loginAs(ids.admin));

  it.each([
    ["fila r=999999999", '<row r="999999999"><c r="A999999999"><v>1</v></c></row>', /referencia de celda inválida/],
    ["fila r=0", '<row r="0"><c><v>1</v></c></row>', /referencia de celda inválida/],
    ["columna ZZZZ1", '<row r="1"><c r="ZZZZ1"><v>1</v></c></row>', /referencia de celda inválida/],
    ["entidad &#x110000;", '<row r="1"><c r="A1" t="inlineStr"><is><t>&#x110000;</t></is></c></row>', /caracteres inválidos/],
  ])("%s", async (_n, sheetXml, message) => {
    const { xlsxParts, zip } = await import("./xlsx-fixture");
    for (const route of [prev, conf]) {
      const res = await route("ventas", zip(xlsxParts([], { sheetXml }), false));
      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(message);
    }
    expect(fake.calls.some((c) => c.method !== "list")).toBe(false);
    expect(fake.calls.some((c) => c.tableId === T.ventas.id)).toBe(false); // ni siquiera llega a leer la base
  });
});

describe("vista previa · estados, importes y cliente", () => {
  beforeEach(() => loginAs(ids.admin));

  it("Factura C, NC, USD con TC, USD sin TC (error), tipo desconocido (error), cliente por CUIT y sin match", async () => {
    const res = await prev("ventas", ventasFile());
    expect(res.status).toBe(200);
    const f = res.json.filas as (Fila & { clientePorCuit: { id: string } | null })[];
    expect(f.map((x) => x.estado)).toEqual(["nueva", "nueva", "nueva", "error", "error", "nueva"]);
    expect(f[3].error).toBe(MENSAJES.monedaSinTc);
    expect(f[4].error).toBe(MENSAJES.tipoNoReconocido);
    expect(f[0].importes).toMatchObject({ total: 100000, iva: 0, neto: 100000 });
    expect(f[1].importes).toMatchObject({ total: -60550, iva: -10550, neto: -50000 });
    expect(f[2].importes).toMatchObject({ total: 10006001, iva: 1736868, neto: 8219108 });
    expect(f[0].clave).toBe(`11|2|1|${CUIT_CLIENTE}`);
    expect(f[0].clientePorCuit).toEqual({ id: ids.cliente, nombre: "QA Cliente" });
    expect(f[5].clientePorCuit).toBeNull();
    expect(f[5].clave).toBe(`11|2|6|${CUIT_OTRO}`); // documento con guiones → solo dígitos
    expect(res.json.resumen).toEqual({ total: 6, nuevas: 4, yaImportadas: 0, duplicadas: 0, conError: 2 });
    expect(res.json.contexto.categoriaVentasPorDefecto).toEqual({ nombre: "Ingresos por servicios", id: ids.ingresoRP });
    expect(fake.calls.some((c) => c.method !== "list")).toBe(false); // la vista previa no escribe
  });

  it("duplicada en el archivo y ya importada (Clave ARCA en la tabla)", async () => {
    fake.seed(T.ventas.id, { [V.claveArca]: `11|2|1|${CUIT_CLIENTE}` });
    const file = arcaXlsx("ventas", [
      factura({ numeroDesde: 1, nroDocReceptor: CUIT_CLIENTE }),
      factura({ numeroDesde: 7, nroDocReceptor: CUIT_CLIENTE }),
      factura({ numeroDesde: 7, nroDocReceptor: CUIT_CLIENTE }),
    ]);
    const res = await prev("ventas", file);
    expect(res.json.filas.map((x: Fila) => x.estado)).toEqual(["ya_importada", "nueva", "duplicada"]);
  });

  it("Compras: proveedor existente por CUIT, nuevo (uno solo para dos filas) y CUIT inválido (error)", async () => {
    const file = arcaXlsx("compras", [
      factura({ numeroDesde: 1, nroDocEmisor: CUIT_PROV_EXISTE }),
      factura({ numeroDesde: 2, nroDocEmisor: CUIT_PROV_NUEVO, denominacionEmisor: "QA Proveedor nuevo" }),
      factura({ numeroDesde: 3, nroDocEmisor: CUIT_PROV_NUEVO, denominacionEmisor: "QA Proveedor nuevo" }),
      factura({ numeroDesde: 4, nroDocEmisor: "20123456789" }),
    ]);
    const res = await prev("compras", file);
    const f = res.json.filas;
    expect(f[0].proveedor).toEqual({ id: ids.proveedor, nombre: "QA Proveedor existente", cuit: CUIT_PROV_EXISTE, categoriaPorDefecto: ids.gastoDefault });
    expect(f[1].proveedor).toMatchObject({ id: null, nombre: "QA Proveedor nuevo", cuit: CUIT_PROV_NUEVO });
    expect(f[3]).toMatchObject({ estado: "error", error: MENSAJES.cuitEmisorInvalido });
    expect(res.json.proveedoresNuevos).toEqual([{ nombre: "QA Proveedor nuevo", cuit: CUIT_PROV_NUEVO }]);
  });
});

describe("confirmar · escritura", () => {
  beforeEach(() => loginAs(ids.admin));

  it("Ventas: escribe las filas nuevas con columnas ARCA, tipo, clave y cliente; la categoría por defecto no se escribe; re-importar → 0 nuevas", async () => {
    const res = await conf("ventas", ventasFile());
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ importadas: 4, omitidas: { yaImportadas: 0, duplicadasEnArchivo: 0, enParalelo: 0 }, proveedoresCreados: [] });
    expect(res.json.conError).toEqual([
      { fila: 7, motivo: MENSAJES.monedaSinTc },
      { fila: 8, motivo: MENSAJES.tipoNoReconocido },
    ]);
    const rows = fake.rows(T.ventas.id);
    expect(rows).toHaveLength(4);
    const first = rows.find((r) => r.fields[V.numeroDesde] === 1)!.fields;
    expect(first).toEqual({
      [V.claveArca]: `11|2|1|${CUIT_CLIENTE}`,
      [V.fecha]: "2026-10-15",
      [V.tipo]: "11 - Factura C",
      [V.tipoComprobante]: [ids.factC],
      [V.puntoVenta]: 2,
      [V.numeroDesde]: 1,
      [V.numeroHasta]: 1,
      [V.codAutorizacion]: "76123456789012",
      [V.tipoDocReceptor]: "CUIT",
      [V.nroDocReceptor]: CUIT_CLIENTE,
      [V.denominacionReceptor]: "QA Cliente",
      [V.moneda]: "$",
      [V.impTotal]: 1000,
      [V.totalIva]: 0,
      [V.cliente]: [ids.cliente],
    });
    const usd = rows.find((r) => r.fields[V.numeroDesde] === 3)!.fields;
    expect(usd).toMatchObject({ [V.tipoCambio]: 1000.5, [V.moneda]: "DOL", [V.otrosTributos]: 0.5 });
    expect(usd).not.toHaveProperty(V.cliente); // sin match por CUIT
    // ninguna escritura manda campos calculados
    const { COMPUTED_FIELDS } = await import("@/lib/airtable/schema");
    for (const r of rows) for (const k of Object.keys(r.fields)) expect(COMPUTED_FIELDS.has(k)).toBe(false);
    // lotes de ≤ 10
    expect(fake.calls.filter((c) => c.method === "create").every((c) => (c.payload as unknown[]).length <= 10)).toBe(true);

    const again = await conf("ventas", ventasFile());
    expect(again.json).toMatchObject({ importadas: 0, omitidas: { yaImportadas: 4 } });
    expect(fake.rows(T.ventas.id)).toHaveLength(4);
  });

  it("Ventas: las ediciones del usuario se escriben; el proyecto cambia el cliente", async () => {
    const clave = `11|2|1|${CUIT_CLIENTE}`;
    const res = await conf("ventas", arcaXlsx("ventas", [factura({ numeroDesde: 1, nroDocReceptor: CUIT_CLIENTE })]), {
      ediciones: { [clave]: { proyecto: ids.proyecto, unidadNegocio: ids.un2, categoria: ids.ingreso, mesDevengado: "2026-09", observaciones: "  QA nota  " } },
    });
    expect(res.status).toBe(200);
    expect(fake.rows(T.ventas.id)[0].fields).toMatchObject({
      [V.proyecto]: [ids.proyecto],
      [V.cliente]: [ids.otroCliente],
      [V.unidadNegocio]: [ids.un2],
      [V.categoria]: [ids.ingreso],
      [V.mesDevengado]: "2026-09-01",
      [V.observaciones]: "QA nota",
    });
  });

  it("Compras: crea el proveedor nuevo una vez, linkea ambos; categoría por defecto del proveedor existente; socio", async () => {
    const file = arcaXlsx("compras", [
      factura({ numeroDesde: 1, nroDocEmisor: CUIT_PROV_EXISTE }),
      factura({ numeroDesde: 2, nroDocEmisor: CUIT_PROV_NUEVO, denominacionEmisor: "QA Proveedor nuevo" }),
      factura({ numeroDesde: 3, nroDocEmisor: CUIT_PROV_NUEVO, denominacionEmisor: "QA Proveedor nuevo" }),
    ]);
    const res = await conf("compras", file, { ediciones: { [`11|2|3|${CUIT_PROV_NUEVO}`]: { socio: ids.socio } } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ importadas: 3, proveedoresCreados: [{ nombre: "QA Proveedor nuevo", cuit: CUIT_PROV_NUEVO }] });
    const provs = fake.rows(T.proveedores.id);
    expect(provs).toHaveLength(2);
    const nuevo = provs.find((p) => p.fields[T.proveedores.fields.cuit] === CUIT_PROV_NUEVO)!;
    expect(nuevo.fields).toEqual({ [T.proveedores.fields.nombre]: "QA Proveedor nuevo", [T.proveedores.fields.cuit]: CUIT_PROV_NUEVO });
    const by = (n: number) => fake.rows(T.compras.id).find((r) => r.fields[C.numeroDesde] === n)!.fields;
    expect(by(1)).toMatchObject({ [C.proveedor]: [ids.proveedor], [C.categoria]: [ids.gastoDefault] });
    expect(by(2)).toMatchObject({ [C.proveedor]: [nuevo.id] });
    expect(by(2)).not.toHaveProperty(C.categoria);
    expect(by(3)).toMatchObject({ [C.proveedor]: [nuevo.id], [C.socio]: [ids.socio] });
  });

  it.each([
    ["proyecto Cerrado", "ventas", { proyecto: "cerrado" }, /elegí un proyecto activo/],
    ["proyecto inexistente", "ventas", { proyecto: "recNOEXISTE00000X" }, /elegí un proyecto activo/],
    ["categoría de gasto en Ventas", "ventas", { categoria: "gastoDefault" }, /categoría de ingreso/],
    ["categoría de ingreso en Compras", "compras", { categoria: "ingreso" }, /categoría de gasto/],
    ["socio en Ventas", "ventas", { socio: "socio" }, /socio válido/],
    ["mes inválido", "ventas", { mesDevengado: "2026-13" }, /mes devengado/],
    ["observaciones muy largas", "ventas", { observaciones: "x".repeat(2001) }, /2000 caracteres/],
    ["clave desconocida dentro de la edición", "ventas", { cliente: "x" }, /formato esperado/],
  ])("edición inválida (%s) → 400 y no se escribe nada", async (_n, tabla, ed, message) => {
    const doc = tabla === "ventas" ? CUIT_CLIENTE : CUIT_PROV_EXISTE;
    const resolved = Object.fromEntries(Object.entries(ed).map(([k, v]) => [k, ids[v as string] ?? v]));
    const res = await conf(tabla, arcaXlsx(tabla as "ventas", [factura({ numeroDesde: 1, nroDocReceptor: doc, nroDocEmisor: doc })]), { ediciones: { [`11|2|1|${doc}`]: resolved } });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(tabla === "ventas" && "cliente" in ed ? message : new RegExp(`Revisá la fila 4: .*${message.source}`));
    expect(fake.calls.some((c) => c.method === "create")).toBe(false);
  });

  it("ediciones de filas que no son nuevas se ignoran; JSON roto → 400", async () => {
    fake.seed(T.ventas.id, { [V.claveArca]: `11|2|1|${CUIT_CLIENTE}` });
    const file = arcaXlsx("ventas", [factura({ numeroDesde: 1, nroDocReceptor: CUIT_CLIENTE })]);
    expect((await conf("ventas", file, { ediciones: { [`11|2|1|${CUIT_CLIENTE}`]: { proyecto: "recNOEXISTE00000X" } } })).json).toMatchObject({ importadas: 0 });
    expect((await conf("ventas", file, { rawEdiciones: "{roto" })).status).toBe(400);
  });
});

describe("confirmar · rollback y carreras", () => {
  beforeEach(() => loginAs(ids.admin));
  const muchas = (n: number) => arcaXlsx("ventas", Array.from({ length: n }, (_, i) => factura({ numeroDesde: i + 1, nroDocReceptor: CUIT_CLIENTE })));

  it("falla inyectada en el 2.º lote (injectFault) → se borra lo escrito → 503", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "import:ventas:1");
    const res = await conf("ventas", muchas(15));
    expect(res).toEqual({ status: 503, json: { error: "No pudimos completar el cambio. No se modificó nada; probá de nuevo." } });
    expect(fake.calls.filter((c) => c.method === "create" && c.tableId === T.ventas.id)).toHaveLength(1); // el 1.º lote sí se escribió
    expect(fake.rows(T.ventas.id)).toHaveLength(0);
  });

  it("Compras: falla después de crear proveedores → también se borran los proveedores creados", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "import:compras:0");
    const res = await conf("compras", arcaXlsx("compras", [factura({ nroDocEmisor: CUIT_PROV_NUEVO })]));
    expect(res.status).toBe(503);
    expect(fake.rows(T.proveedores.id).map((r) => r.id)).toEqual([ids.proveedor]);
    expect(fake.rows(T.compras.id)).toHaveLength(0);
  });

  it("si el rollback también falla → 500 «quedó incompleto»", async () => {
    fake.failWhen((call, i) => call.method === "create" && call.tableId === T.ventas.id && i === 1, new Error("caída"));
    fake.failWhen((call) => call.method === "delete" && call.tableId === T.ventas.id, new Error("caída"));
    const res = await conf("ventas", muchas(12));
    expect(res).toEqual({ status: 500, json: { error: "El cambio quedó incompleto. Avisá a un administrador." } });
  });

  it("la verificación posterior no se puede leer → se deshace todo → 503", async () => {
    let lists = 0;
    fake.failWhen((call) => call.method === "list" && call.tableId === T.ventas.id && ++lists === 2, new Error("caída"));
    const res = await conf("ventas", muchas(3));
    expect(res).toEqual({ status: 503, json: { error: "No pudimos verificar el cambio. No se modificó nada; probá de nuevo." } });
    expect(fake.rows(T.ventas.id)).toHaveLength(0);
  });

  it("carrera de Clave ARCA: dos importaciones del mismo archivo a la vez → cada clave queda una sola vez", async () => {
    fake.barrier("create", T.ventas.id, 2); // las dos pasan el chequeo previo antes de escribir
    const [a, b] = await Promise.all([conf("ventas", muchas(3)), conf("ventas", muchas(3))]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.json.importadas + b.json.importadas).toBe(3);
    expect(a.json.omitidas.enParalelo + b.json.omitidas.enParalelo).toBe(3);
    const claves = fake.rows(T.ventas.id).map((r) => r.fields[V.claveArca]);
    expect(new Set(claves).size).toBe(3);
    expect(claves).toHaveLength(3);
  });

  it("carrera de proveedor: dos importaciones crean el mismo proveedor → la que pierde se deshace entera (409)", async () => {
    fake.barrier("create", T.proveedores.id, 2);
    const fileA = arcaXlsx("compras", [factura({ numeroDesde: 1, nroDocEmisor: CUIT_PROV_NUEVO })]);
    const fileB = arcaXlsx("compras", [factura({ numeroDesde: 2, nroDocEmisor: CUIT_PROV_NUEVO })]);
    const results = await Promise.all([conf("compras", fileA), conf("compras", fileB)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.json.error).toMatch(/Otra importación creó al mismo tiempo el proveedor/);
    expect(fake.rows(T.proveedores.id).filter((p) => p.fields[T.proveedores.fields.cuit] === CUIT_PROV_NUEVO)).toHaveLength(1);
    expect(fake.rows(T.compras.id)).toHaveLength(1);
  });
});

describe("rutas · guard y límites", () => {
  it("sin sesión → 401; Empleado → 403 en vista previa y confirmar, sin leer nada de Ventas/Compras", async () => {
    for (const route of [prev, conf]) expect((await route("ventas", ventasFile())).status).toBe(401);
    await loginAs(ids.empleado);
    for (const route of [prev, conf]) for (const tabla of ["ventas", "compras"]) expect((await route(tabla, ventasFile())).status).toBe(403);
    expect(fake.calls.some((c) => c.tableId === T.ventas.id || c.tableId === T.compras.id || c.method !== "list")).toBe(false);
  });

  it("tabla desconocida 404; no multipart 415; Origin de otro sitio 403; archivo que no es .xlsx 400; más de 4 MB 413", async () => {
    await loginAs(ids.admin);
    expect((await prev("horas", ventasFile())).status).toBe(404);
    const cookie = `${SESSION_COOKIE}=${cookieJar.get(SESSION_COOKIE)}`;
    const json = new NextRequest("http://localhost/api/admin/importar/ventas/preview", { method: "POST", body: "{}", headers: { cookie, "content-type": "application/json" } });
    expect((await preview.POST(json, { params: Promise.resolve({ tabla: "ventas" }) })).status).toBe(415);
    expect((await prev("ventas", ventasFile(), { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await prev("ventas", ventasFile(), { headers: { origin: "http://localhost" } })).status).toBe(200);
    expect((await prev("ventas", ventasFile(), { name: "arca.csv" })).json.error).toMatch(/tiene que ser un \.xlsx/);
    expect((await prev("ventas", Buffer.from("no es zip"))).json.error).toMatch(/tiene que ser un \.xlsx/);
    expect((await prev("ventas", null)).json.error).toBe("Elegí el archivo .xlsx de ARCA.");
    const big = Buffer.concat([ventasFile(), Buffer.alloc(MAX_FILE_BYTES)]);
    expect(await prev("ventas", big)).toEqual({ status: 413, json: { error: "El archivo supera los 4 MB. Exportá un período más corto desde ARCA." } });
  });
});
