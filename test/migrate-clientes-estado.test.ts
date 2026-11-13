import { describe, expect, it } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { LEAD_IDS, migrateClientesEstado } from "../scripts/lib/migrate-clientes-estado.mjs";

const C = TABLES.clientes;
const F = C.fields;
const CLIENTE_IDS = Array.from({ length: 9 }, (_, i) => `recCLIENTE0000${String(i).padStart(3, "0")}`);

type Rec = { id: string; fields: Record<string, unknown> };

/** Airtable falso para el script: Meta (campo Estado), list paginado, PATCH y DELETE por lotes. */
function fakeBase(opts: { choices?: string[]; mutate?: (records: Rec[]) => void } = {}) {
  const records: Rec[] = [
    ...CLIENTE_IDS.map((id, i) => ({ id, fields: { [F.nombre]: `C${i}`, [F.sigla]: `C${String.fromCharCode(65 + i)}`, [F.estado]: "Cliente" } })),
    ...LEAD_IDS.map((id, i) => ({ id, fields: { [F.nombre]: `L${i}`, [F.estado]: "Lead" } })),
  ];
  opts.mutate?.(records);
  const choices = opts.choices ?? ["Cliente", "Lead", "Ex cliente", "Perdido", "Activo", "Inactivo"];
  const writes: { method: string; size: number; typecast: boolean }[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    if (u.pathname.includes("/meta/")) {
      return Response.json({ tables: [{ id: C.id, fields: [{ id: F.estado, type: "singleSelect", options: { choices: choices.map((name) => ({ name })) } }] }] });
    }
    if (method === "GET") {
      const start = Number(u.searchParams.get("offset") ?? 0);
      const page = records.slice(start, start + 5); // pagina de a 5 para probar offset
      return Response.json({ records: page, ...(start + 5 < records.length ? { offset: String(start + 5) } : {}) });
    }
    if (method === "PATCH") {
      const body = JSON.parse(String(init!.body));
      writes.push({ method, size: body.records.length, typecast: !!body.typecast });
      for (const r of body.records) Object.assign(records.find((x) => x.id === r.id)!.fields, r.fields);
      return Response.json({ records: body.records });
    }
    if (method === "DELETE") {
      const ids = u.searchParams.getAll("records[]");
      writes.push({ method, size: ids.length, typecast: false });
      for (const id of ids) records.splice(records.findIndex((r) => r.id === id), 1);
      return Response.json({ records: ids.map((id) => ({ id, deleted: true })) });
    }
    throw new Error(`inesperado ${method}`);
  };
  return { fn: fn as unknown as typeof fetch, records, writes };
}

async function run(base: ReturnType<typeof fakeBase>, apply: boolean) {
  const out: string[] = [];
  const err: string[] = [];
  const snapshots: unknown[] = [];
  const code = await migrateClientesEstado({
    token: "patSECRETO.valor",
    baseId: "appxGhn6qLbmWvMke",
    apply,
    fetch: base.fn,
    log: (s: string) => out.push(s),
    error: (s: string) => err.push(s),
    saveSnapshot: (d: unknown) => {
      snapshots.push(structuredClone(d));
      return "backups/clientes-test.json";
    },
  });
  return { code, out: out.join("\n"), err: err.join("\n"), snapshots };
}

describe("migrate:clientes-estado", () => {
  it("dry-run: snapshot completo, plan, nada escrito", async () => {
    const base = fakeBase();
    const r = await run(base, false);
    expect(r.code).toBe(0);
    expect(base.writes).toEqual([]);
    expect((r.snapshots[0] as { records: unknown[] }).records).toHaveLength(16);
    expect(r.out).toContain("Leads a borrar: 7 de 7");
    expect(r.out).toContain("Cliente → Activo: 9 registros");
    expect(r.out).toContain("Dry-run OK");
    expect(r.out + r.err).not.toContain("patSECRETO");
  });

  it("--apply: Cliente → Activo en lotes de ≤10 sin typecast, borra los 7 leads y verifica", async () => {
    const base = fakeBase();
    const r = await run(base, true);
    expect(r.code).toBe(0);
    expect(base.records).toHaveLength(9);
    expect(base.records.every((x) => x.fields[F.estado] === "Activo")).toBe(true);
    expect(base.writes.every((w) => w.size <= 10 && !w.typecast)).toBe(true);
    for (const id of LEAD_IDS) expect(r.out).toContain(id);
    expect(r.out).toContain("✔ Verificado: 9 registros, todos Activo");
  });

  it("idempotente: una segunda corrida no escribe nada y verifica OK", async () => {
    const base = fakeBase();
    await run(base, true);
    const before = base.writes.length;
    const again = await run(base, true);
    expect(again.code).toBe(0);
    expect(base.writes.length).toBe(before);
    expect(again.out).toContain("Leads a borrar: 0 de 7");
  });

  it.each([
    ["un lead cambió de Estado", (rs: Rec[]) => (rs.find((r) => r.id === LEAD_IDS[0])!.fields[F.estado] = "Cliente")],
    ["un lead tiene un proyecto", (rs: Rec[]) => (rs.find((r) => r.id === LEAD_IDS[1])!.fields[F.proyectos] = ["recPPPPPPPPPPPPPP"])],
    ["un lead tiene ventas", (rs: Rec[]) => (rs.find((r) => r.id === LEAD_IDS[2])!.fields[F.ventas] = ["recVVVVVVVVVVVVVV"])],
    ["un lead tiene Tesorería", (rs: Rec[]) => (rs.find((r) => r.id === LEAD_IDS[3])!.fields[F.tesoreria] = ["recTTTTTTTTTTTTTT"])],
    ["un registro Ex cliente sin mapeo", (rs: Rec[]) => (rs[0].fields[F.estado] = "Ex cliente")],
    ["otro Lead fuera de la lista", (rs: Rec[]) => (rs[0].fields[F.estado] = "Lead")],
  ])("aborta sin escribir si %s", async (_name, mutate) => {
    const base = fakeBase({ mutate });
    const r = await run(base, true);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Precondiciones");
    expect(base.writes).toEqual([]);
  });

  it("si faltan las opciones Activo / Inactivo: no las crea (ni con typecast) y aborta sin escribir", async () => {
    const base = fakeBase({ choices: ["Cliente", "Lead", "Ex cliente", "Perdido"] });
    const r = await run(base, true);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Faltan las opciones Activo e Inactivo");
    expect(base.writes).toEqual([]);
    expect((await run(base, false)).code).toBe(1);
  });

  it("sin token o base → 1", async () => {
    const err: string[] = [];
    expect(await migrateClientesEstado({ token: "", baseId: "", saveSnapshot: () => "", error: (s: string) => err.push(s) })).toBe(1);
    expect(err.join()).toContain("Faltan AIRTABLE_TOKEN");
  });
});
