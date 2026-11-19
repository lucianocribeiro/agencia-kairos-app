import { describe, expect, it } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import {
  AMBIENTES,
  CLIENTES_FIELDS,
  CONCEPTOS,
  ESTADOS,
  FIELDS,
  FORBIDDEN_NAME,
  INVERSES,
  linkFields,
  NAMES,
  SELF_INVERSE_NAME,
  setupComprobantesEmitidos,
  TIPOS,
  UPDATE_SCHEMA_MESSAGE,
} from "../scripts/lib/setup-comprobantes-emitidos.mjs";

const T = TABLES.comprobantesEmitidos;
const F = T.fields;
const IDS = { clientes: TABLES.clientes.id, usuarios: TABLES.usuarios.id, horas: TABLES.horas.id, ventas: TABLES.ventas.id, self: T.id };
type Field = { id: string; name: string; type: string; options?: Record<string, unknown> };

/** Base real según schema.ts: la tabla, los inversos (por inverseLinkFieldId) y los campos de Clientes. */
function base(over: { drop?: string; extra?: Field; selfName?: string; sinClientes?: boolean } = {}) {
  const byName = Object.fromEntries(Object.entries(NAMES).map(([k, n]) => [n, F[k as keyof typeof F]]));
  const fields: Field[] = [...FIELDS, ...linkFields(IDS)]
    .filter((f) => f.name !== over.drop)
    .map((f) => ({ id: byName[f.name], name: f.name, type: f.type, options: f.options }));
  const linkId = (name: string) => byName[name];
  for (const f of fields) if (f.type === "multipleRecordLinks" && f.name !== "Comprobante asociado") f.options = { ...f.options, inverseLinkFieldId: undefined };
  fields.push({ id: F.corregidoPor, name: over.selfName ?? SELF_INVERSE_NAME, type: "multipleRecordLinks", options: { linkedTableId: T.id, inverseLinkFieldId: F.comprobanteAsociado } });
  fields.find((f) => f.name === "Comprobante asociado")!.options = { linkedTableId: T.id, inverseLinkFieldId: F.corregidoPor };
  if (over.extra) fields.push(over.extra);
  const inverse = (tableKey: keyof typeof INVERSES) => ({
    id: (TABLES[tableKey].fields as Record<string, string>).comprobantesEmitidos,
    name: "Comprobantes emitidos",
    type: "multipleRecordLinks",
    options: { linkedTableId: T.id, inverseLinkFieldId: linkId(NAMES[INVERSES[tableKey] as keyof typeof NAMES]) },
  });
  const clientes = {
    id: IDS.clientes,
    name: "Clientes",
    primaryFieldId: TABLES.clientes.fields.nombre,
    fields: [inverse("clientes"), ...(over.sinClientes ? [] : [{ id: TABLES.clientes.fields.razonSocial, name: "Razón social", type: "singleLineText" }, { id: TABLES.clientes.fields.domicilioComercial, name: "Domicilio comercial", type: "singleLineText" }])],
  };
  return [
    clientes,
    { id: IDS.usuarios, name: "Usuarios", primaryFieldId: "fldX", fields: [inverse("usuarios")] },
    { id: IDS.horas, name: "Horas", primaryFieldId: "fldX", fields: [inverse("horas")] },
    { id: IDS.ventas, name: "Ventas", primaryFieldId: "fldX", fields: [inverse("ventas")] },
    { id: T.id, name: "Comprobantes emitidos", primaryFieldId: F.comprobante, fields },
  ];
}

function fakeFetch(tables: unknown[], conceptos: string[]) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const u = String(url);
    calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET" && u.includes("/meta/")) return Response.json({ tables });
    if (method === "GET") return Response.json({ records: conceptos.map((c, i) => ({ id: `rec${i}`, fields: { [TABLES.parametros.fields.concepto]: c } })) });
    if (u.endsWith("/tables")) return Response.json({ id: "tblNUEVANUEVA0000", name: "Comprobantes emitidos", primaryFieldId: "fldN1", fields: [] });
    return Response.json({ id: "fldNUEVO000000002" });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

async function run(tables: unknown[], verifyOnly: boolean, conceptos = CONCEPTOS.map((c) => c.concepto)) {
  const fake = fakeFetch(tables, conceptos);
  const out: string[] = [];
  const err: string[] = [];
  const code = await setupComprobantesEmitidos({ token: "patFAKE", baseId: "appxGhn6qLbmWvMke", verifyOnly, fetch: fake.fn, log: (s: string) => out.push(s), error: (s: string) => err.push(s) });
  return { code, calls: fake.calls, out: out.join("\n"), err: err.join("\n") };
}

describe("setup-comprobantes-emitidos (CC-F5-10)", () => {
  it("--verify, todo coincide → 0, solo GET", async () => {
    const r = await run(base(), true);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("--verify con algo distinto o faltante → 1, solo GET", async () => {
    for (const [tables, conceptos] of [
      [base({ drop: "CAE" }), undefined],
      [base({ selfName: "From field: Comprobante asociado" }), undefined],
      [base({ sinClientes: true }), undefined],
      [base(), ["Domicilio comercial"]],
      [base().filter((t) => t.name !== "Comprobantes emitidos"), undefined],
    ] as const) {
      const r = await run(tables as unknown[], true, conceptos as string[] | undefined);
      expect(r.code).toBe(1);
      expect(r.calls.every((c) => c.method === "GET")).toBe(true);
    }
  });

  it("--verify: un campo con forma de secreto o calculado → 1", async () => {
    for (const extra of [{ id: "fldX0000000000001", name: "Certificado", type: "multilineText" }, { id: "fldX0000000000002", name: "Token", type: "singleLineText" }, { id: "fldX0000000000003", name: "Suma", type: "formula" }]) {
      const r = await run(base({ extra }), true);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/no puede existir/);
    }
  });

  it("sin --verify y sin nada → crea Clientes, la tabla, los 5 links y los Conceptos; 1 con «Actualizá schema.ts…»", async () => {
    const vacia = base({ sinClientes: true }).filter((t) => t.name !== "Comprobantes emitidos");
    const r = await run(vacia, false, []);
    expect(r.code).toBe(1);
    expect(r.err).toContain(UPDATE_SCHEMA_MESSAGE);
    const posts = r.calls.filter((c) => c.method === "POST");
    expect(posts.filter((c) => c.url.endsWith(`/tables/${IDS.clientes}/fields`)).map((c) => (c.body as { name: string }).name)).toEqual(Object.values(CLIENTES_FIELDS));
    expect(posts.find((c) => c.url.endsWith("/tables"))!.body).toMatchObject({ name: "Comprobantes emitidos", fields: FIELDS });
    expect(posts.filter((c) => c.url.includes("/tables/tblNUEVANUEVA0000/fields")).map((c) => (c.body as { name: string }).name)).toEqual(["Cliente", "Usuario", "Horas", "Venta", "Comprobante asociado"]);
    const records = posts.find((c) => c.url.endsWith(`/${TABLES.parametros.id}`))!.body as { records: { fields: Record<string, string> }[] };
    expect(records.records.map((x) => x.fields[TABLES.parametros.fields.concepto])).toEqual(CONCEPTOS.map((c) => c.concepto));
    expect(records.records.every((x) => !(TABLES.parametros.fields.valor in x.fields))).toBe(true);
  });

  it("CC-F5-12: falta «Clave ARCA» en una tabla existente → --verify 1 (solo GET); sin --verify la crea en esa tabla", async () => {
    const v = await run(base({ drop: "Clave ARCA" }), true);
    expect(v.code).toBe(1);
    expect(v.err).toContain("no tiene el campo «Clave ARCA»");
    expect(v.calls.every((c) => c.method === "GET")).toBe(true);
    const c = await run(base({ drop: "Clave ARCA" }), false);
    const post = c.calls.filter((x) => x.method === "POST");
    expect(post).toHaveLength(1);
    expect(post[0]).toMatchObject({ url: expect.stringContaining(`/tables/${T.id}/fields`), body: { name: "Clave ARCA", type: "singleLineText" } });
    expect(c.err).toContain(UPDATE_SCHEMA_MESSAGE);
  });

  it("el inverso del link a sí misma se renombra a «Corregido por»", async () => {
    const r = await run(base({ selfName: "From field: Comprobante asociado" }), false);
    expect(r.calls.find((c) => c.method === "PATCH")).toMatchObject({ url: expect.stringContaining(`/tables/${T.id}/fields/${F.corregidoPor}`), body: { name: SELF_INVERSE_NAME } });
  });
});

describe("la tabla nunca guarda secretos ni cálculos", () => {
  it("nombres y claves sin certificado/clave/token; sin fórmulas; precisiones pedidas", () => {
    for (const n of [...FIELDS.map((f) => f.name), "Cliente", "Usuario", "Horas", "Venta", "Comprobante asociado", SELF_INVERSE_NAME]) expect(n).not.toMatch(FORBIDDEN_NAME);
    expect(FIELDS.find((f) => f.name === "Clave ARCA")).toMatchObject({ type: "singleLineText" });
    // «claveArca» es la Clave ARCA de la Venta (código|PV|número|CUIT), no un secreto (CC-F5-12).
    for (const key of Object.keys(F).filter((k) => k !== "claveArca")) expect(key).not.toMatch(/cert|key|token|clave|password|sign/i);
    expect(FORBIDDEN_NAME.test("Clave ARCA")).toBe(false);
    expect(FORBIDDEN_NAME.test("Clave fiscal")).toBe(true);
    expect(FORBIDDEN_NAME.test("Clave ARCA fiscal")).toBe(true);
    for (const f of FIELDS) expect(["formula", "rollup", "lookup", "count", "multipleLookupValues"]).not.toContain(f.type);
    expect(FIELDS.find((f) => f.name === "Alícuota")).toMatchObject({ options: { precision: 4 } });
    for (const n of ["Neto", "IVA", "Total"]) expect(FIELDS.find((f) => f.name === n)).toMatchObject({ options: { precision: 2 } });
    for (const n of ["Punto de venta", "Número"]) expect(FIELDS.find((f) => f.name === n)).toMatchObject({ options: { precision: 0 } });
  });

  it("opciones y claves coinciden con schema.ts", () => {
    expect(TIPOS).toEqual([...T.choices.tipo]);
    expect(AMBIENTES).toEqual([...T.choices.ambiente]);
    expect(ESTADOS).toEqual([...T.choices.estado]);
    expect(Object.keys(NAMES).sort()).toEqual(Object.keys(F).sort());
  });
});
