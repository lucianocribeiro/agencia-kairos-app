import { describe, expect, it } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import {
  LEAD_IDS,
  LEGACY_CLIENTE,
  LEGACY_LEAD,
  migrateClientesEstado,
  NEW_OPTIONS,
  OLD_OPTIONS,
} from "../scripts/lib/migrate-clientes-estado.mjs";

const C = TABLES.clientes;
const F = C.fields;
const CLIENTE_IDS = Array.from({ length: 9 }, (_, i) => `recCLIENTE0000${String(i).padStart(3, "0")}`);
const EX_CLIENTE = OLD_OPTIONS[2];

type Rec = { id: string; fields: Record<string, unknown> };
type Resume = { version: number; table: string; snapshot: Rec[]; plan: { leadIds: string[]; clienteIds: string[] } };

/** Airtable falso para el script: Meta (campo Estado), list paginado, PATCH y DELETE por lotes. */
function fakeBase(opts: { choices?: string[]; mutate?: (records: Rec[]) => void; onDelete?: (records: Rec[]) => void; failDelete?: boolean } = {}) {
  const records: Rec[] = [
    ...CLIENTE_IDS.map((id, i) => ({ id, fields: { [F.nombre]: `C${i}`, [F.sigla]: `C${String.fromCharCode(65 + i)}`, [F.estado]: LEGACY_CLIENTE } })),
    ...LEAD_IDS.map((id, i) => ({ id, fields: { [F.nombre]: `L${i}`, [F.estado]: LEGACY_LEAD } })),
  ];
  opts.mutate?.(records);
  const choices = opts.choices ?? [...OLD_OPTIONS, ...NEW_OPTIONS];
  const writes: { method: string; size: number; typecast: boolean }[] = [];
  const state = { failDelete: !!opts.failDelete };
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
      if (state.failDelete) return Response.json({ error: { type: "SERVER_ERROR" } }, { status: 503 });
      const ids = u.searchParams.getAll("records[]");
      writes.push({ method, size: ids.length, typecast: false });
      for (const id of ids) records.splice(records.findIndex((r) => r.id === id), 1);
      opts.onDelete?.(records);
      return Response.json({ records: ids.map((id) => ({ id, deleted: true })) });
    }
    throw new Error(`inesperado ${method}`);
  };
  return { fn: fn as unknown as typeof fetch, records, writes, state };
}

/** Archivo de reanudación en memoria (como el de backups/, que nunca se pisa). */
function resumeStore(initial: Resume | null = null) {
  const store = { value: initial as Resume | null, saves: 0, savedBeforeFirstWrite: null as boolean | null };
  return store;
}

async function run(base: ReturnType<typeof fakeBase>, apply: boolean, store = resumeStore()) {
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
    loadResume: () => (store.value ? structuredClone(store.value) : null),
    saveResume: (d: unknown) => {
      if (store.value) throw new Error("el archivo de reanudación ya existe");
      store.savedBeforeFirstWrite = base.writes.length === 0;
      store.value = structuredClone(d) as Resume;
      store.saves++;
      return "backups/migrate-clientes-estado.resume.json";
    },
  });
  return { code, out: out.join("\n"), err: err.join("\n"), snapshots, store };
}

describe("migrate:clientes-estado · primera corrida", () => {
  it("dry-run: snapshot completo, plan, nada escrito ni archivo de reanudación", async () => {
    const base = fakeBase();
    const r = await run(base, false);
    expect(r.code).toBe(0);
    expect(base.writes).toEqual([]);
    expect(r.store.value).toBeNull();
    expect((r.snapshots[0] as { records: unknown[] }).records).toHaveLength(16);
    expect(r.out).toContain("Leads a borrar: 7 de 7");
    expect(r.out).toContain(`${LEGACY_CLIENTE} → Activo: 9 de 9`);
    expect(r.out).toContain("Dry-run OK");
    expect(r.out + r.err).not.toContain("patSECRETO");
  });

  it("--apply: guarda el archivo de reanudación antes de escribir; Cliente → Activo (≤10, sin typecast); borra los 7 leads; verifica", async () => {
    const base = fakeBase();
    const r = await run(base, true);
    expect(r.code).toBe(0);
    expect(r.store.saves).toBe(1);
    expect(r.store.savedBeforeFirstWrite).toBe(true);
    expect(r.store.value!.snapshot).toHaveLength(16);
    expect(r.store.value!.plan).toEqual({ leadIds: [...LEAD_IDS].sort(), clienteIds: [...CLIENTE_IDS].sort() });
    expect(base.records.map((x) => x.id).sort()).toEqual([...CLIENTE_IDS].sort());
    expect(base.records.every((x) => x.fields[F.estado] === "Activo")).toBe(true);
    expect(base.writes.every((w) => w.size <= 10 && !w.typecast)).toBe(true);
    for (const id of LEAD_IDS) expect(r.out).toContain(id);
    expect(r.out).toContain("✔ Verificado: 9 registros");
  });

  it("primera corrida con un lead que falta → aborta sin escribir", async () => {
    const base = fakeBase({ mutate: (rs) => rs.splice(rs.findIndex((x) => x.id === LEAD_IDS[3]), 1) });
    const r = await run(base, true);
    expect(r.code).toBe(1);
    expect(r.err).toContain(`faltan leads (sin archivo de reanudación no se acepta): ${LEAD_IDS[3]}`);
    expect(base.writes).toEqual([]);
    expect(r.store.value).toBeNull();
  });

  it.each([
    ["un lead cambió de Estado", (rs: Rec[]) => (rs.find((r) => r.id === LEAD_IDS[0])!.fields[F.estado] = LEGACY_CLIENTE)],
    ["un lead tiene un proyecto", (rs: Rec[]) => (rs.find((r) => r.id === LEAD_IDS[1])!.fields[F.proyectos] = ["recPPPPPPPPPPPPPP"])],
    ["un lead tiene ventas", (rs: Rec[]) => (rs.find((r) => r.id === LEAD_IDS[2])!.fields[F.ventas] = ["recVVVVVVVVVVVVVV"])],
    ["un lead tiene Tesorería", (rs: Rec[]) => (rs.find((r) => r.id === LEAD_IDS[3])!.fields[F.tesoreria] = ["recTTTTTTTTTTTTTT"])],
    ["un cliente pasó a Ex cliente (8 Cliente)", (rs: Rec[]) => (rs[0].fields[F.estado] = EX_CLIENTE)],
    ["hay un registro de más (17)", (rs: Rec[]) => rs.push({ id: "recEXTRA000000001", fields: { [F.estado]: LEGACY_CLIENTE } })],
    ["hay un cliente de menos (15)", (rs: Rec[]) => rs.splice(0, 1)],
    ["un cliente ya está en Activo (sin archivo de reanudación)", (rs: Rec[]) => (rs[0].fields[F.estado] = "Activo")],
  ])("aborta sin escribir si %s", async (_name, mutate) => {
    const base = fakeBase({ mutate });
    const r = await run(base, true);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Precondiciones");
    expect(base.writes).toEqual([]);
  });

  it("si faltan las opciones Activo / Inactivo: no las crea (ni con typecast) y aborta sin escribir", async () => {
    const base = fakeBase({ choices: OLD_OPTIONS });
    const r = await run(base, true);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Faltan las opciones Activo e Inactivo");
    expect(base.writes).toEqual([]);
    expect(r.store.value).toBeNull();
  });

  it("verificación final: si la cantidad final ≠ 9 → falla", async () => {
    const base = fakeBase({ onDelete: (rs) => rs.push({ id: "recINTRUSO0000001", fields: { [F.estado]: "Activo" } }) });
    const r = await run(base, true);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Verificación final");
    expect(r.err).toContain("hay 10 registros, se esperaban 9");
    expect(r.err).toContain("los IDs finales no son exactamente los 9 del plan");
  });
});

describe("migrate:clientes-estado · reanudación", () => {
  it("después de un borrado parcial: con el archivo, acepta los leads que faltan y termina", async () => {
    const base = fakeBase({ failDelete: true });
    const first = await run(base, true);
    expect(first.code).toBe(1); // falló el DELETE después de actualizar
    expect(first.store.value).not.toBeNull();
    expect(base.records.filter((x) => x.fields[F.estado] === "Activo")).toHaveLength(9);
    // Una parte de los leads sí se borró antes de cortarse
    for (const id of LEAD_IDS.slice(0, 3)) base.records.splice(base.records.findIndex((x) => x.id === id), 1);
    base.state.failDelete = false;

    const again = await run(base, true, first.store);
    expect(again.code).toBe(0);
    expect(again.store.saves).toBe(1); // no se vuelve a escribir el archivo
    expect(again.out).toContain("Reanudando");
    expect(again.out).toContain("Leads a borrar: 4 de 7");
    expect(again.out).toContain("✔ Verificado: 9 registros");
    expect(base.records.map((x) => x.id).sort()).toEqual([...CLIENTE_IDS].sort());
  });

  it("una corrida más después de terminar: no escribe nada y verifica OK (idempotente)", async () => {
    const base = fakeBase();
    const first = await run(base, true);
    const writes = base.writes.length;
    const again = await run(base, true, first.store);
    expect(again.code).toBe(0);
    expect(base.writes.length).toBe(writes);
    expect(again.out).toContain("Leads a borrar: 0 de 7");
  });

  it.each([
    ["el plan no coincide con su snapshot", (r: Resume) => (r.plan.clienteIds = [...r.plan.clienteIds.slice(1), "recOTRO0000000001"])],
    ["los leads del plan no son los 7", (r: Resume) => (r.plan.leadIds = r.plan.leadIds.slice(1))],
    ["el snapshot no es el de la primera corrida", (r: Resume) => r.snapshot.splice(0, 1)],
    ["es de otra tabla", (r: Resume) => (r.table = "tblOTRATABLA00000")],
    ["es de otra versión", (r: Resume) => (r.version = 99)],
  ])("archivo de reanudación que no coincide (%s) → aborta sin escribir", async (_name, corrupt) => {
    const base = fakeBase({ failDelete: true });
    const first = await run(base, true);
    corrupt(first.store.value!);
    base.state.failDelete = false;
    const before = base.writes.length;
    const again = await run(base, true, first.store);
    expect(again.code).toBe(1);
    expect(again.err).toContain("Reanudación");
    expect(base.writes.length).toBe(before);
  });

  it("con el archivo, un lead que falta y no está en el plan → aborta (registro fuera del plan)", async () => {
    const base = fakeBase({ failDelete: true });
    const first = await run(base, true);
    base.records.push({ id: "recAJENO000000001", fields: { [F.estado]: LEGACY_LEAD } });
    base.state.failDelete = false;
    const again = await run(base, true, first.store);
    expect(again.code).toBe(1);
    expect(again.err).toContain("recAJENO000000001: registro que no está en el plan");
  });

  it("archivo ilegible → aborta", async () => {
    const base = fakeBase();
    const r = await run(base, true, resumeStore({ invalid: true } as unknown as Resume));
    expect(r.code).toBe(1);
    expect(base.writes).toEqual([]);
  });
});

it("sin token o base → 1", async () => {
  const err: string[] = [];
  expect(
    await migrateClientesEstado({ token: "", baseId: "", saveSnapshot: () => "", loadResume: () => null, saveResume: () => "", error: (s: string) => err.push(s) }),
  ).toBe(1);
  expect(err.join()).toContain("Faltan AIRTABLE_TOKEN");
});
