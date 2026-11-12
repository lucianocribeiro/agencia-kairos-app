/**
 * Cliente de Airtable en memoria para tests. Implementa list/create/update
 * sobre registros guardados por tabla. No evalúa fórmulas (el código de auth
 * vuelve a filtrar en JS), pero guarda cada llamada para poder inspeccionarla.
 */
type Fields = Record<string, unknown>;
interface Rec {
  id: string;
  createdTime: string;
  fields: Fields;
}

export interface FakeCall {
  method: "list" | "create" | "update" | "delete";
  tableId: string;
  options?: unknown;
  payload?: unknown;
}

export function createFakeAirtable() {
  const tables = new Map<string, Rec[]>();
  const calls: FakeCall[] = [];
  const failures = new Map<string, Error>(); // `${method}:${tableId}` → error
  /** Fallas a medida: se evalúan con la llamada ya registrada (útil para "el 2.º update de proyectos"). */
  const rules: { when: (call: FakeCall, index: number) => boolean; error: Error }[] = [];
  /** Barreras: las primeras `count` llamadas esperan a que lleguen todas (simula requests concurrentes). */
  const barriers = new Map<string, { count: number; waiting: (() => void)[]; arrived: number }>();
  const hold = async (method: string, tableId: string) => {
    const b = barriers.get(`${method}:${tableId}`);
    if (!b || b.arrived >= b.count) return;
    b.arrived++;
    if (b.arrived === b.count) b.waiting.splice(0).forEach((release) => release());
    else await new Promise<void>((resolve) => b.waiting.push(resolve));
  };
  let seq = 0;
  const newId = () => `rec${String(++seq).padStart(14, "0")}`;
  const rows = (tableId: string) => {
    if (!tables.has(tableId)) tables.set(tableId, []);
    return tables.get(tableId)!;
  };
  const maybeFail = (method: string, tableId: string, call: FakeCall = calls[calls.length - 1]) => {
    const err = failures.get(`${method}:${tableId}`);
    if (err) throw err;
    const index = calls.filter((c) => c.method === call.method && c.tableId === call.tableId).indexOf(call);
    const rule = rules.find((r) => r.when(call, index));
    if (rule) throw rule.error;
  };
  const pick = (fields: Fields, keys: readonly string[]) =>
    Object.fromEntries(keys.filter((k) => k in fields).map((k) => [k, fields[k]]));

  const client = {
    async list(tableId: string, options: { fields: readonly string[]; filterByFormula?: { toString(): string }; maxRecords?: number }) {
      calls.push({ method: "list", tableId, options });
      maybeFail("list", tableId);
      let out = rows(tableId);
      // Soporte mínimo de RECORD_ID() = "rec…" para get por ID.
      const m = /^RECORD_ID\(\) = "(rec[A-Za-z0-9]{14})"$/.exec(options.filterByFormula?.toString() ?? "");
      if (m) out = out.filter((r) => r.id === m[1]);
      return out.slice(0, options.maxRecords ?? Infinity).map((r) => ({ ...r, fields: pick(r.fields, options.fields) }));
    },
    async get(tableId: string, recordId: string, options: { fields: readonly string[] }) {
      calls.push({ method: "list", tableId, options: { ...options, filterByFormula: `RECORD_ID() = "${recordId}"` } });
      maybeFail("list", tableId);
      const rec = rows(tableId).find((r) => r.id === recordId);
      return rec ? { ...rec, fields: pick(rec.fields, options.fields) } : null;
    },
    async delete(tableId: string, ids: readonly string[]) {
      calls.push({ method: "delete", tableId, payload: ids });
      maybeFail("delete", tableId);
      const list = rows(tableId);
      const deleted: string[] = [];
      for (const id of ids) {
        const i = list.findIndex((r) => r.id === id);
        if (i >= 0) {
          list.splice(i, 1);
          deleted.push(id);
        }
      }
      return deleted;
    },
    async create(tableId: string, records: Fields[]) {
      const call: FakeCall = { method: "create", tableId, payload: records };
      calls.push(call);
      await hold("create", tableId);
      maybeFail("create", tableId, call);
      return records.map((fields) => {
        const rec = { id: newId(), createdTime: new Date().toISOString(), fields: { ...fields } };
        rows(tableId).push(rec);
        return { ...rec, fields: {} };
      });
    },
    async update(tableId: string, records: { id: string; fields: Fields }[]) {
      const call: FakeCall = { method: "update", tableId, payload: records };
      calls.push(call);
      await hold("update", tableId);
      maybeFail("update", tableId, call);
      return records.map(({ id, fields }) => {
        const rec = rows(tableId).find((r) => r.id === id);
        if (!rec) throw new Error(`no existe ${id}`);
        for (const [k, v] of Object.entries(fields)) {
          if (v === null) delete rec.fields[k];
          else rec.fields[k] = v;
        }
        return { ...rec, fields: {} };
      });
    },
  };

  return {
    client,
    calls,
    rows,
    seed(tableId: string, fields: Fields, id = newId()) {
      rows(tableId).push({ id, createdTime: new Date().toISOString(), fields: { ...fields } });
      return id;
    },
    fail(method: FakeCall["method"], tableId: string, error = new Error("falla simulada")) {
      failures.set(`${method}:${tableId}`, error);
    },
    /** Falla la llamada que cumpla `when` (index = n.º de llamada de ese método a esa tabla, desde 0). */
    failWhen(when: (call: FakeCall, index: number) => boolean, error: Error = new Error("falla simulada")) {
      rules.push({ when, error });
    },
    /** Las primeras `count` llamadas de `method` a `tableId` esperan a que lleguen todas. */
    barrier(method: "create" | "update", tableId: string, count: number) {
      barriers.set(`${method}:${tableId}`, { count, waiting: [], arrived: 0 });
    },
    /** Cambia el createdTime de un registro (para probar desempates). */
    setCreatedTime(tableId: string, id: string, createdTime: string) {
      rows(tableId).find((r) => r.id === id)!.createdTime = createdTime;
    },
    reset() {
      tables.clear();
      calls.length = 0;
      failures.clear();
      rules.length = 0;
      barriers.clear();
    },
  };
}
