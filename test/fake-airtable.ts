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
  let seq = 0;
  const newId = () => `rec${String(++seq).padStart(14, "0")}`;
  const rows = (tableId: string) => {
    if (!tables.has(tableId)) tables.set(tableId, []);
    return tables.get(tableId)!;
  };
  const maybeFail = (method: string, tableId: string) => {
    const err = failures.get(`${method}:${tableId}`);
    if (err) throw err;
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
    async create(tableId: string, records: Fields[]) {
      calls.push({ method: "create", tableId, payload: records });
      maybeFail("create", tableId);
      return records.map((fields) => {
        const rec = { id: newId(), createdTime: new Date().toISOString(), fields: { ...fields } };
        rows(tableId).push(rec);
        return { ...rec, fields: {} };
      });
    },
    async update(tableId: string, records: { id: string; fields: Fields }[]) {
      calls.push({ method: "update", tableId, payload: records });
      maybeFail("update", tableId);
      return records.map(({ id, fields }) => {
        const rec = rows(tableId).find((r) => r.id === id);
        if (!rec) throw new Error(`no existe ${id}`);
        Object.assign(rec.fields, fields);
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
    reset() {
      tables.clear();
      calls.length = 0;
      failures.clear();
    },
  };
}
