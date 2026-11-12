import "server-only";

import { getEnv } from "@/lib/env";
import { AirtableError, codeForStatus, sanitizeMessage } from "./errors";
import { Formula, recordIdIs } from "./formula";
import { assertFieldIds, assertRecordId, assertTableId, assertWritableFields } from "./payload";

export { AirtableError } from "./errors";
export { assertFieldIds, assertRecordId, assertTableId, assertWritableFields } from "./payload";
export type { AirtableErrorCode } from "./errors";

const API_URL = "https://api.airtable.com/v0";
const BATCH_SIZE = 10;
const MAX_PAGE_SIZE = 100;

/** Campos de un registro, indexados por ID de campo. */
export type Fields = Record<string, unknown>;

export interface AirtableRecord<F extends Fields = Fields> {
  id: string;
  createdTime: string;
  fields: Partial<F>;
}

export interface SortSpec {
  field: string;
  direction?: "asc" | "desc";
}

export interface ListOptions {
  /** IDs de campo a devolver. Obligatorio: pedí solo lo que necesitás. */
  fields: readonly string[];
  filterByFormula?: Formula;
  sort?: readonly SortSpec[];
  view?: string;
  maxRecords?: number;
  pageSize?: number;
}

export interface WriteOptions {
  typecast?: boolean;
  /**
   * IDs de campo a incluir en los registros devueltos. Por defecto, solo los
   * campos escritos. Airtable devuelve el registro completo; acá se recorta
   * para no filtrar campos sensibles por accidente.
   */
  returnFields?: readonly string[];
}

export interface AirtableClientOptions {
  token: string;
  baseId: string;
  /** Inyectables para tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
  baseDelayMs?: number;
  requestsPerSecond?: number;
  timeoutMs?: number;
}

/**
 * Política de reintentos por tipo de operación:
 * - "read" (list/get): reintenta 429, 5xx y errores de red.
 * - "idempotent" (update PATCH, delete): reintenta 429 y 5xx; no errores de red.
 * - "create": NUNCA reintenta. La documentación de Airtable no garantiza que un
 *   429 implique que el request no se aplicó
 *   (https://airtable.com/developers/web/api/rate-limits y
 *   https://airtable.com/developers/web/api/errors), y un 5xx o un error de red
 *   pueden haber creado el registro: reintentar podría duplicarlo.
 */
type RetryPolicy = "read" | "idempotent" | "create";

interface RequestInit_ {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: URLSearchParams;
  body?: unknown;
  retry: RetryPolicy;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function invalid(message: string): AirtableError {
  return new AirtableError({ code: "invalid_input", message });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function pick(fields: Fields, keys: readonly string[]): Fields {
  const out: Fields = {};
  for (const key of keys) if (key in fields) out[key] = fields[key];
  return out;
}

export class AirtableClient {
  readonly #token: string;
  readonly #baseId: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #maxRetries: number;
  readonly #baseDelayMs: number;
  readonly #minIntervalMs: number;
  readonly #timeoutMs: number;
  #nextSlot = 0;

  constructor(options: AirtableClientOptions) {
    if (!options.token) throw invalid("Falta el token de Airtable");
    if (!/^app[A-Za-z0-9]{14}$/.test(options.baseId)) throw invalid("ID de base inválido");
    this.#token = options.token;
    this.#baseId = options.baseId;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
    this.#maxRetries = options.maxRetries ?? 3;
    this.#baseDelayMs = options.baseDelayMs ?? 1000;
    this.#minIntervalMs = 1000 / (options.requestsPerSecond ?? 5);
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  // ── Lecturas ────────────────────────────────────────────────────────────

  /** Lista todos los registros (recorre todas las páginas). */
  async list<F extends Fields = Fields>(
    tableId: string,
    options: ListOptions,
  ): Promise<AirtableRecord<F>[]> {
    assertTableId(tableId);
    if (options.fields.length === 0) throw invalid("Indicá al menos un campo en `fields`");
    assertFieldIds(tableId, options.fields);
    if (options.sort) assertFieldIds(tableId, options.sort.map((s) => s.field));

    const records: AirtableRecord<F>[] = [];
    let offset: string | undefined;
    do {
      // POST /listRecords: misma semántica que GET, sin límite de largo de URL
      // y sin la fórmula en la URL.
      const page = await this.#request<{ records: AirtableRecord<F>[]; offset?: string }>({
        method: "POST",
        path: `/${this.#baseId}/${tableId}/listRecords`,
        retry: "read",
        body: {
          returnFieldsByFieldId: true,
          fields: options.fields,
          filterByFormula: options.filterByFormula?.toString(),
          sort: options.sort?.map((s) => ({ field: s.field, direction: s.direction ?? "asc" })),
          view: options.view,
          maxRecords: options.maxRecords,
          pageSize: Math.min(options.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE),
          offset,
        },
      });
      records.push(...page.records);
      offset = page.offset;
    } while (offset && (options.maxRecords === undefined || records.length < options.maxRecords));

    return records;
  }

  /**
   * Trae un registro por ID con solo los campos pedidos. Devuelve null si no existe.
   * (El endpoint GET de un registro no admite `fields[]`, por eso se usa list.)
   */
  async get<F extends Fields = Fields>(
    tableId: string,
    recordId: string,
    options: { fields: readonly string[] },
  ): Promise<AirtableRecord<F> | null> {
    assertRecordId(recordId);
    const [record] = await this.list<F>(tableId, {
      fields: options.fields,
      filterByFormula: recordIdIs(recordId),
      maxRecords: 1,
    });
    return record ?? null;
  }

  // ── Escrituras ──────────────────────────────────────────────────────────
  // Se envían en lotes de hasta 10 registros. Varios lotes NO son atómicos.
  // create no se reintenta nunca; update y delete sí ante 429/5xx (ver RetryPolicy).

  async create<F extends Fields = Fields>(
    tableId: string,
    records: readonly Partial<F>[],
    options: WriteOptions = {},
  ): Promise<AirtableRecord<F>[]> {
    assertTableId(tableId);
    records.forEach((fields) => assertWritableFields(tableId, fields));
    if (options.returnFields) assertFieldIds(tableId, options.returnFields);

    const out: AirtableRecord<F>[] = [];
    for (const batch of chunk(records, BATCH_SIZE)) {
      const res = await this.#request<{ records: AirtableRecord<F>[] }>({
        method: "POST",
        path: `/${this.#baseId}/${tableId}`,
        retry: "create",
        body: {
          returnFieldsByFieldId: true,
          typecast: options.typecast ?? false,
          records: batch.map((fields) => ({ fields })),
        },
      });
      res.records.forEach((rec, i) => {
        const keys = options.returnFields ?? Object.keys(batch[i] ?? {});
        out.push({ ...rec, fields: pick(rec.fields, keys) as Partial<F> });
      });
    }
    return out;
  }

  /** PATCH: solo modifica los campos enviados. */
  async update<F extends Fields = Fields>(
    tableId: string,
    records: readonly { id: string; fields: Partial<F> }[],
    options: WriteOptions = {},
  ): Promise<AirtableRecord<F>[]> {
    assertTableId(tableId);
    records.forEach((r) => {
      assertRecordId(r.id);
      assertWritableFields(tableId, r.fields);
    });
    if (options.returnFields) assertFieldIds(tableId, options.returnFields);

    const out: AirtableRecord<F>[] = [];
    for (const batch of chunk(records, BATCH_SIZE)) {
      const res = await this.#request<{ records: AirtableRecord<F>[] }>({
        method: "PATCH",
        path: `/${this.#baseId}/${tableId}`,
        retry: "idempotent",
        body: {
          returnFieldsByFieldId: true,
          typecast: options.typecast ?? false,
          records: batch.map((r) => ({ id: r.id, fields: r.fields })),
        },
      });
      const sent = new Map(batch.map((r) => [r.id, r.fields]));
      for (const rec of res.records) {
        const keys = options.returnFields ?? Object.keys(sent.get(rec.id) ?? {});
        out.push({ ...rec, fields: pick(rec.fields, keys) as Partial<F> });
      }
    }
    return out;
  }

  /** Borra registros. Devuelve los IDs borrados. */
  async delete(tableId: string, recordIds: readonly string[]): Promise<string[]> {
    assertTableId(tableId);
    recordIds.forEach(assertRecordId);

    const deleted: string[] = [];
    for (const batch of chunk(recordIds, BATCH_SIZE)) {
      const query = new URLSearchParams();
      batch.forEach((id) => query.append("records[]", id));
      const res = await this.#request<{ records: { id: string; deleted: boolean }[] }>({
        method: "DELETE",
        path: `/${this.#baseId}/${tableId}`,
        retry: "idempotent",
        query,
      });
      deleted.push(...res.records.filter((r) => r.deleted).map((r) => r.id));
    }
    return deleted;
  }

  // ── Transporte ──────────────────────────────────────────────────────────

  /** Reserva un turno: como máximo `requestsPerSecond` requests por segundo. */
  async #throttle(): Promise<void> {
    const now = this.#now();
    const slot = Math.max(now, this.#nextSlot);
    this.#nextSlot = slot + this.#minIntervalMs;
    const wait = slot - now;
    if (wait > 0) await this.#sleep(wait);
  }

  #backoff(attempt: number, retryAfterHeader: string | null): number {
    const exp = this.#baseDelayMs * 2 ** attempt;
    const jitter = Math.random() * this.#baseDelayMs * 0.25;
    const retryAfter = Number(retryAfterHeader);
    const fromHeader = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
    return Math.max(exp + jitter, fromHeader);
  }

  async #request<T>(req: RequestInit_): Promise<T> {
    const qs = req.query?.toString();
    const url = `${API_URL}${req.path}${qs ? `?${qs}` : ""}`;

    for (let attempt = 0; ; attempt++) {
      await this.#throttle();

      let res: Response;
      try {
        res = await this.#fetch(url, {
          method: req.method,
          headers: {
            Authorization: `Bearer ${this.#token}`,
            ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
          cache: "no-store",
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch {
        // No se adjunta la causa: podría incluir la URL o el request.
        if (req.retry === "read" && attempt < this.#maxRetries) {
          await this.#sleep(this.#backoff(attempt, null));
          continue;
        }
        throw new AirtableError({ code: "network_error", message: "No se pudo conectar con Airtable" });
      }

      if (res.ok) return (await res.json()) as T;

      const retryable = req.retry !== "create" && (res.status === 429 || res.status >= 500);
      if (retryable && attempt < this.#maxRetries) {
        await res.body?.cancel().catch(() => {});
        await this.#sleep(this.#backoff(attempt, res.headers.get("retry-after")));
        continue;
      }
      throw await this.#toError(res);
    }
  }

  async #toError(res: Response): Promise<AirtableError> {
    let airtableType: string | undefined;
    let apiMessage: string | undefined;
    try {
      const data = (await res.json()) as { error?: string | { type?: string; message?: string } };
      if (typeof data.error === "string") airtableType = data.error;
      else if (data.error) {
        airtableType = data.error.type;
        apiMessage = data.error.message;
      }
    } catch {
      // body vacío o no JSON
    }
    const type = airtableType ? sanitizeMessage(airtableType, [this.#token]) : undefined;
    const detail = apiMessage ? `: ${sanitizeMessage(apiMessage, [this.#token])}` : "";
    return new AirtableError({
      code: codeForStatus(res.status),
      status: res.status,
      airtableType: type,
      message: `Airtable respondió ${res.status}${type ? ` (${type})` : ""}${detail}`,
    });
  }
}

let shared: AirtableClient | null = null;

/** Cliente compartido, configurado con las variables de entorno (validación perezosa). */
export function getAirtableClient(): AirtableClient {
  if (!shared) {
    const env = getEnv();
    shared = new AirtableClient({ token: env.AIRTABLE_TOKEN, baseId: env.AIRTABLE_BASE_ID });
  }
  return shared;
}
