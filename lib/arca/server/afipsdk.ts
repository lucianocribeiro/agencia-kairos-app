import "server-only";

import { DEFAULT_AFIP_SDK_URL } from "./config";

/**
 * Cliente mínimo de la API de Afip SDK (automatización «mis-comprobantes», CC-F5-03).
 * Mismo estilo que AirtableClient: `fetch`, `sleep` y `now` inyectables, timeout por pedido.
 *
 * - POST /automations (crear el job): NUNCA se reintenta (podría crear dos jobs y gastar
 *   dos intentos de la clave fiscal).
 * - GET /automations/:id: reintenta 429, 5xx y errores de red hasta 3 veces, con backoff +
 *   jitter, respetando Retry-After.
 * - Los errores (AfipSdkError) nunca llevan el token, el body del pedido (con la clave
 *   fiscal) ni el de la respuesta. Mensajes del proveedor (CC-F5-04):
 *   · error de un job (GET 400 o status "error"): SIEMPRE el mensaje fijo (ya no tenemos
 *     las credenciales para limpiarlo);
 *   · 400 del create: el data.message solo si la clave tiene ≥ 6 caracteres y el texto limpio
 *     ya no contiene la clave, la CUIT de login (con o sin guiones) ni nada con forma de CUIT;
 *     si no, el mensaje fijo. Nunca se loguea.
 * - Toda respuesta se lee con un tope de 8 MB antes de JSON.parse.
 */

export type AfipSdkErrorKind =
  /** 401/403: token inválido o sin permisos. */
  | "config"
  /** 400: Afip SDK rechazó el pedido o el job terminó con error (credenciales, filtros…). */
  | "rejected"
  /** 429, 5xx, timeout o error de red. */
  | "unavailable"
  /** Respuesta con una forma que no esperamos. */
  | "unexpected";

export class AfipSdkError extends Error {
  readonly kind: AfipSdkErrorKind;
  /** Status HTTP de Afip SDK (0 si no hubo respuesta). */
  readonly status: number;
  /** Solo "rejected": mensaje de Afip SDK ya limpio, para mostrarle al Admin. Nunca se loguea. */
  readonly detail: string | undefined;

  constructor(init: { kind: AfipSdkErrorKind; status?: number; detail?: string }) {
    super(`Afip SDK: ${init.kind}${init.status ? ` (${init.status})` : ""}`);
    this.name = "AfipSdkError";
    this.kind = init.kind;
    this.status = init.status ?? 0;
    this.detail = init.detail;
  }

  /** Lo que se puede loguear: tipo y status. Sin `detail`. */
  toJSON() {
    return { name: this.name, kind: this.kind, status: this.status };
  }
}

/** Largo máximo del mensaje del proveedor, incluido el «…». */
export const AFIP_SDK_DETAIL_MAX = 300;
/** Tope de bytes de una respuesta de Afip SDK (antes de JSON.parse). */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** Clave fiscal más corta cuyo eco se puede limpiar con confianza; más corta → mensaje fijo. */
export const MIN_CLAVE_PARA_MENSAJE = 6;
/** Retry-After máximo que se respeta. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** Mensaje fijo de un rechazo de ARCA (credenciales, filtros o error del job). */
export const MENSAJE_RECHAZO = "ARCA rechazó la consulta. Revisá el usuario y la clave fiscal, o probá de nuevo más tarde.";

/** Lo que ve el Admin por cada tipo de error (lo usa apiRoute en lib/auth/api.ts). */
export const AFIP_SDK_MESSAGES = {
  config: "La integración con ARCA no está configurada correctamente.",
  rejected: MENSAJE_RECHAZO,
  unavailable: "ARCA no respondió; probá de nuevo en unos minutos.",
  unexpected: "ARCA devolvió una respuesta inesperada. Probá de nuevo.",
} as const;

/** Status y mensaje de la respuesta para un AfipSdkError. 400 solo con el mensaje ya limpio de Afip SDK. */
export function afipSdkErrorResponse(err: AfipSdkError): { status: 400 | 503; error: string } {
  if (err.kind === "rejected") return { status: 400, error: err.detail || AFIP_SDK_MESSAGES.rejected };
  return { status: 503, error: AFIP_SDK_MESSAGES[err.kind] };
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const CUIT_SHAPE = /\d{2}-?\d{8}-?\d/;
const stripControl = (text: string) => text.replace(CONTROL, "");

/** Variantes de un secreto a buscar: tal cual, sin controles y, si es una CUIT, sin y con guiones. */
function variants(secret: string): string[] {
  const out = new Set<string>();
  for (const v of [secret, stripControl(secret)]) if (v) out.add(v);
  const digits = secret.replace(/\D/g, "");
  if (digits.length === 11) {
    out.add(digits);
    out.add(`${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`);
  }
  return [...out];
}

/** Acota a 300 caracteres contando el «…». */
export function truncateDetail(text: string): string {
  return text.length > AFIP_SDK_DETAIL_MAX ? `${text.slice(0, AFIP_SDK_DETAIL_MAX - 1)}…` : text;
}

/**
 * Limpia un mensaje del proveedor: saca los caracteres de control ANTES de comparar, redacta
 * todas las variantes de cada secreto (de cualquier largo), cualquier secuencia con forma de
 * CUIT y acota a 300 (con el «…»).
 */
export function sanitizeDetail(message: string, secrets: readonly string[] = []): string {
  let out = stripControl(message);
  const all = secrets.flatMap(variants).sort((a, b) => b.length - a.length);
  for (const v of all) out = out.split(v).join("[redactado]");
  out = out.replace(new RegExp(CUIT_SHAPE.source, "g"), "[CUIT]").replace(/\s+/g, " ").trim();
  return truncateDetail(out);
}

/**
 * Mensaje de un 400 del create: el del proveedor (limpio) solo si es seguro mostrarlo; si no,
 * el mensaje fijo. Seguro = clave de ≥ 6 caracteres sin caracteres de control y el texto limpio
 * ya no contiene la clave, la CUIT de login (con o sin guiones) ni nada con forma de CUIT.
 */
export function createRejectionDetail(message: string | undefined, creds: { username: string; password: string; cuit: string }): string {
  // Clave corta o con caracteres de control: su eco no se puede reconocer con certeza → mensaje fijo.
  if (!message || [...creds.password].length < MIN_CLAVE_PARA_MENSAJE || stripControl(creds.password) !== creds.password) return MENSAJE_RECHAZO;
  const clean = sanitizeDetail(message, [creds.password, creds.username, creds.cuit]);
  const leaks = [...variants(creds.password), ...variants(creds.username)].some((v) => clean.includes(v)) || CUIT_SHAPE.test(clean);
  return leaks || clean === "" ? MENSAJE_RECHAZO : clean;
}

/**
 * Retry-After: delta-seconds o HTTP-date, como máximo 60 s. Inválido, cero o en el pasado →
 * null (backoff normal).
 */
export function parseRetryAfter(header: string | null, now: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const ms = Number(value) * 1000;
    return ms > 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : null;
  }
  const at = Date.parse(value);
  if (!Number.isFinite(at) || !/[a-z]/i.test(value)) return null;
  const ms = at - now;
  return ms > 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : null;
}

/** Lee el body con tope de bytes y lo parsea. Más grande que el tope → AfipSdkError "unexpected". */
export async function readJsonCapped(res: Response, maxBytes: number = MAX_RESPONSE_BYTES): Promise<unknown> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new AfipSdkError({ kind: "unexpected", status: res.status });
  }
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new AfipSdkError({ kind: "unexpected", status: res.status });
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

export interface CreateJobParams {
  /** CUIT de la empresa (Parámetros «CUIT»), 11 dígitos. */
  cuit: string;
  /** CUIT de login de ARCA, 11 dígitos. */
  username: string;
  password: string;
  /** "E" emitidos (Ventas) | "R" recibidos (Compras). */
  t: "E" | "R";
  /** "dd/mm/yyyy - dd/mm/yyyy" */
  fechaEmision: string;
}

export type JobStatus =
  | { status: "in_process" }
  | { status: "complete"; data: unknown }
  /** El job terminó con error. Sin mensaje del proveedor: se muestra MENSAJE_RECHAZO. */
  | { status: "error" };

export interface AfipSdkClientOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

/** ID de job aceptable (uuid u otro identificador simple): nunca se arma una URL con otra cosa. */
export const JOB_ID_RE = /^[A-Za-z0-9-]{1,100}$/;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function messageOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const data = (body as { data?: unknown }).data;
  if (typeof data === "object" && data !== null && typeof (data as { message?: unknown }).message === "string") return (data as { message: string }).message;
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

export class AfipSdkClient {
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #maxRetries: number;
  readonly #baseDelayMs: number;
  readonly #timeoutMs: number;

  constructor(options: AfipSdkClientOptions) {
    if (!options.token) throw new AfipSdkError({ kind: "config" });
    this.#token = options.token;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_AFIP_SDK_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
    this.#maxRetries = options.maxRetries ?? 3;
    this.#baseDelayMs = options.baseDelayMs ?? 1000;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Crea el job. Nunca se reintenta. Devuelve el ID del job. */
  async createJob(params: CreateJobParams): Promise<string> {
    const creds = { username: params.username, password: params.password, cuit: params.cuit };
    const res = await this.#send("POST", "/automations", {
      automation: "mis-comprobantes",
      params: {
        cuit: params.cuit,
        username: params.username,
        password: params.password,
        filters: { t: params.t, fechaEmision: params.fechaEmision },
      },
    }, false, creds);
    const body = (await readJsonCapped(res)) as { id?: unknown; status?: unknown } | null;
    if (body && typeof body === "object" && body.status === "error") throw new AfipSdkError({ kind: "rejected", status: res.status, detail: createRejectionDetail(messageOf(body), creds) });
    if (!body || typeof body.id !== "string" || !JOB_ID_RE.test(body.id)) throw new AfipSdkError({ kind: "unexpected", status: res.status });
    return body.id;
  }

  /**
   * Estado del job (un solo GET, con reintentos ante fallas transitorias). Un estado que no
   * sea complete ni error se trata como "en proceso" (los otros valores no están documentados);
   * el vencimiento de 15 minutos lo corta.
   */
  async getJob(id: string): Promise<JobStatus> {
    if (!JOB_ID_RE.test(id)) throw new AfipSdkError({ kind: "unexpected" });
    const res = await this.#send("GET", `/automations/${encodeURIComponent(id)}`, undefined, true, null);
    const body = (await readJsonCapped(res)) as { status?: unknown; data?: unknown } | null;
    if (!body || typeof body !== "object" || typeof body.status !== "string") throw new AfipSdkError({ kind: "unexpected", status: res.status });
    if (body.status === "complete") return { status: "complete", data: body.data };
    if (body.status === "error" || body.status === "failed") return { status: "error" };
    return { status: "in_process" };
  }

  #backoff(attempt: number, retryAfterHeader: string | null): number {
    const exp = this.#baseDelayMs * 2 ** attempt;
    const jitter = Math.random() * this.#baseDelayMs * 0.25;
    const fromHeader = parseRetryAfter(retryAfterHeader, this.#now());
    return fromHeader ?? exp + jitter;
  }

  /**
   * Manda el pedido. Respuesta 2xx → Response; si no, AfipSdkError (sin bodies). `creds`: solo
   * en el create (para decidir si el mensaje de un 400 se puede mostrar); null en el GET del
   * job → el 400 lleva siempre el mensaje fijo.
   */
  async #send(method: "GET" | "POST", path: string, body: unknown, retry: boolean, creds: { username: string; password: string; cuit: string } | null): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.#fetch(`${this.#baseUrl}${path}`, {
          method,
          headers: { Authorization: `Bearer ${this.#token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch {
        // Timeout o red. No se adjunta la causa (podría incluir la URL o el pedido).
        if (retry && attempt < this.#maxRetries) {
          await this.#sleep(this.#backoff(attempt, null));
          continue;
        }
        throw new AfipSdkError({ kind: "unavailable" });
      }
      if (res.ok) return res;

      const transient = res.status === 429 || res.status >= 500;
      if (transient && retry && attempt < this.#maxRetries) {
        await res.body?.cancel().catch(() => {});
        await this.#sleep(this.#backoff(attempt, res.headers.get("retry-after")));
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel().catch(() => {});
        throw new AfipSdkError({ kind: "config", status: res.status });
      }
      if (res.status === 400) {
        if (!creds) {
          await res.body?.cancel().catch(() => {});
          throw new AfipSdkError({ kind: "rejected", status: 400, detail: MENSAJE_RECHAZO });
        }
        const data = await readJsonCapped(res);
        throw new AfipSdkError({ kind: "rejected", status: 400, detail: createRejectionDetail(messageOf(data), creds) });
      }
      await res.body?.cancel().catch(() => {});
      throw new AfipSdkError({ kind: transient ? "unavailable" : "unexpected", status: res.status });
    }
  }
}
