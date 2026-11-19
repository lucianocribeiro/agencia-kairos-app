import { describe, expect, it } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { ESTADOS, FIELDS, FORBIDDEN_NAME, INVERSE_NAME, NAMES, setupSincronizacionesArca, TIPOS, UPDATE_SCHEMA_MESSAGE, usuarioField } from "../scripts/lib/setup-sincronizaciones-arca.mjs";

const T = TABLES.sincronizacionesArca;
const F = T.fields;
const USUARIOS = TABLES.usuarios.id;

/** La tabla real tal como la devuelve la Meta API (tipos y opciones del script, IDs de schema.ts). */
function table(over: { id?: string; drop?: string; extra?: { id: string; name: string; type: string }; estadoId?: string } = {}) {
  const byName = Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [name, F[key as keyof typeof F]]));
  const fields = [...FIELDS, usuarioField(USUARIOS)]
    .filter((f) => f.name !== over.drop)
    .map((f) => ({ id: f.name === "Estado" && over.estadoId ? over.estadoId : byName[f.name], name: f.name, type: f.type, options: f.options }));
  if (over.extra) fields.push({ ...over.extra, options: undefined });
  return { id: over.id ?? T.id, name: "Sincronizaciones ARCA", primaryFieldId: F.sincronizacion, fields };
}
const usuarios = (inverseId: string | null = TABLES.usuarios.fields.sincronizacionesArca) => ({
  id: USUARIOS,
  name: "Usuarios",
  primaryFieldId: TABLES.usuarios.fields.nombre,
  fields: inverseId ? [{ id: inverseId, name: INVERSE_NAME, type: "multipleRecordLinks", options: { linkedTableId: T.id } }] : [],
});

function fakeFetch(tables: unknown[]) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET") return Response.json({ tables });
    if (String(url).endsWith("/tables")) return Response.json({ id: "tblNUEVANUEVA0000", name: "Sincronizaciones ARCA", primaryFieldId: "fldNUEVO000000001", fields: [{ id: "fldNUEVO000000001", name: "Sincronización", type: "singleLineText" }] });
    return Response.json({ id: "fldNUEVO000000002", name: "Usuario", type: "multipleRecordLinks" });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

async function run(tables: unknown[], verifyOnly: boolean) {
  const fake = fakeFetch(tables);
  const out: string[] = [];
  const err: string[] = [];
  const code = await setupSincronizacionesArca({ token: "patFAKE", baseId: "appxGhn6qLbmWvMke", verifyOnly, fetch: fake.fn, log: (s: string) => out.push(s), error: (s: string) => err.push(s) });
  return { code, calls: fake.calls, out: out.join("\n"), err: err.join("\n") };
}

describe("setup-sincronizaciones-arca", () => {
  it("--verify, tabla e inverso coinciden → 0, solo GET", async () => {
    const r = await run([usuarios(), table()], true);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.calls.map((c) => c.method)).toEqual(["GET"]);
    expect(r.out).toContain("coincide con lib/airtable/schema.ts");
  });

  it("--verify, IDs distintos o falta un campo o el inverso → 1 con los IDs reales, solo GET", async () => {
    for (const tables of [[usuarios(), table({ estadoId: "fldOTRO0000000001" })], [usuarios(), table({ drop: "Mensaje" })], [usuarios(null), table()]]) {
      const r = await run(tables, true);
      expect(r.code).toBe(1);
      expect(r.calls.map((c) => c.method)).toEqual(["GET"]);
      expect(r.err).toContain("IDs reales:");
    }
  });

  it("--verify: un campo con forma de credencial o calculado → 1", async () => {
    for (const extra of [{ id: "fldX0000000000001", name: "CUIT", type: "singleLineText" }, { id: "fldX0000000000002", name: "Clave fiscal", type: "singleLineText" }, { id: "fldX0000000000003", name: "Total", type: "formula" }]) {
      const r = await run([usuarios(), table({ extra })], true);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/no puede existir/);
    }
  });

  it("--verify, tabla inexistente → 1, nunca POST", async () => {
    const r = await run([usuarios()], true);
    expect(r.code).toBe(1);
    expect(r.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("sin --verify, tabla inexistente → POST de la tabla y del link a Usuarios, y 1 con «Actualizá schema.ts…»", async () => {
    const r = await run([usuarios(null)], false);
    expect(r.code).toBe(1);
    expect(r.calls.map((c) => c.method)).toEqual(["GET", "POST", "POST", "GET"]);
    expect(r.calls[1].body).toMatchObject({ name: "Sincronizaciones ARCA", fields: FIELDS });
    expect(r.calls[2]).toMatchObject({ url: expect.stringContaining("/tables/tblNUEVANUEVA0000/fields"), body: { name: "Usuario", type: "multipleRecordLinks", options: { linkedTableId: USUARIOS } } });
    expect(r.out).toContain("tblNUEVANUEVA0000");
    expect(r.err).toContain(UPDATE_SCHEMA_MESSAGE);
  });
});

describe("la tabla nunca guarda credenciales ni cálculos", () => {
  const names = [...FIELDS.map((f) => f.name), "Usuario"];

  it("ni CUIT, ni usuario ARCA, ni clave/password, ni token (script y schema.ts)", () => {
    for (const n of names) expect(n).not.toMatch(FORBIDDEN_NAME);
    for (const key of Object.keys(F)) expect(key).not.toMatch(/cuit|clave|password|username|token/i);
    expect(FORBIDDEN_NAME.test("CUIT")).toBe(true);
    expect(FORBIDDEN_NAME.test("Clave fiscal")).toBe(true);
    expect(FORBIDDEN_NAME.test("Password")).toBe(true);
  });

  it("sin fórmula, rollup, lookup ni count; contadores con precisión 0", () => {
    for (const f of FIELDS) expect(["formula", "rollup", "lookup", "count", "multipleLookupValues"]).not.toContain(f.type);
    for (const n of ["Leídas", "Nuevas", "Ya importadas", "Duplicadas", "Con error", "Importadas"]) expect(FIELDS.find((f) => f.name === n)).toMatchObject({ type: "number", options: { precision: 0 } });
  });

  it("opciones y claves coinciden con schema.ts", () => {
    expect(TIPOS).toEqual([...T.choices.tipo]);
    expect(ESTADOS).toEqual([...T.choices.estado]);
    expect(Object.keys(NAMES).sort()).toEqual(Object.keys(F).sort());
  });
});
