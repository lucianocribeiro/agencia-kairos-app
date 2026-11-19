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
 *   fiscal) ni el de la respuesta. `detail` (el data.message de un 400) se limpia: sin las
 *   credenciales, sin nada con forma de CUIT y acotado a 300 caracteres; nunca se loguea.
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

export const AFIP_SDK_DETAIL_MAX = 300;

/** Lo que ve el Admin por cada tipo de error (lo usa apiRoute en lib/auth/api.ts). */
export const AFIP_SDK_MESSAGES = {
  config: "La integración con ARCA no está configurada correctamente.",
  rejected: "ARCA rechazó la consulta.",
  unavailable: "ARCA no respondió; probá de nuevo en unos minutos.",
  unexpected: "ARCA devolvió una respuesta inesperada. Probá de nuevo.",
} as const;

/** Status y mensaje de la respuesta para un AfipSdkError. 400 solo con el mensaje ya limpio de Afip SDK. */
export function afipSdkErrorResponse(err: AfipSdkError): { status: 400 | 503; error: string } {
  if (err.kind === "rejected") return { status: 400, error: err.detail || AFIP_SDK_MESSAGES.rejected };
  return { status: 503, error: AFIP_SDK_MESSAGES[err.kind] };
}

/**
 * Limpia un mensaje de Afip SDK antes de mostrarlo o guardarlo en el log de la tabla:
 * saca los secretos conocidos (también la CUIT sin guiones), cualquier secuencia con forma
 * de CUIT (11 dígitos, con o sin guiones) y caracteres de control; lo acota a 300.
 */
export function sanitizeDetail(message: string, secrets: readonly string[] = []): string {
  let out = message.replace(/[\u0000-\u001f\u007f]/g, " ");
  const variants = secrets.flatMap((s) => (s ? [s, s.replace(/\D/g, "").length === 11 ? s.replace(/\D/g, "") : ""] : [])).filter((s) => s.length >= 4);
  for (const v of variants.sort((a, b) => b.length - a.length)) out = out.split(v).join("[redactado]");
  out = out.replace(/\b\d{2}-?\d{8}-?\d\b/g, "[CUIT]");
  out = out.replace(/\s+/g, " ").trim();
  return out.length > AFIP_SDK_DETAIL_MAX ? `${out.slice(0, AFIP_SDK_DETAIL_MAX)}…` : out;
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
  | { status: "error"; detail: string };

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
  readonly #maxRetries: number;
  readonly #baseDelayMs: number;
  readonly #timeoutMs: number;

  constructor(options: AfipSdkClientOptions) {
    if (!options.token) throw new AfipSdkError({ kind: "config" });
    this.#token = options.token;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_AFIP_SDK_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#maxRetries = options.maxRetries ?? 3;
    this.#baseDelayMs = options.baseDelayMs ?? 1000;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Crea el job. Nunca se reintenta. Devuelve el ID del job. */
  async createJob(params: CreateJobParams): Promise<string> {
    const secrets = [params.username, params.password, params.cuit];
    const res = await this.#send("POST", "/automations", {
      automation: "mis-comprobantes",
      params: {
        cuit: params.cuit,
        username: params.username,
        password: params.password,
        filters: { t: params.t, fechaEmision: params.fechaEmision },
      },
    }, false, secrets);
    const body = (await res.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
    if (!body || typeof body.id !== "string" || !JOB_ID_RE.test(body.id)) throw new AfipSdkError({ kind: "unexpected", status: res.status });
    if (body.status === "error") throw new AfipSdkError({ kind: "rejected", status: res.status, detail: sanitizeDetail(messageOf(body) ?? "Afip SDK rechazó el pedido.", secrets) });
    return body.id;
  }

  /**
   * Estado del job (un solo GET, con reintentos ante fallas transitorias). Un estado que no
   * sea complete ni error se trata como "en proceso" (los otros valores no están documentados);
   * el vencimiento de 15 minutos lo corta.
   */
  async getJob(id: string): Promise<JobStatus> {
    if (!JOB_ID_RE.test(id)) throw new AfipSdkError({ kind: "unexpected" });
    const res = await this.#send("GET", `/automations/${encodeURIComponent(id)}`, undefined, true, []);
    const body = (await res.json().catch(() => null)) as { status?: unknown; data?: unknown } | null;
    if (!body || typeof body.status !== "string") throw new AfipSdkError({ kind: "unexpected", status: res.status });
    if (body.status === "complete") return { status: "complete", data: body.data };
    if (body.status === "error" || body.status === "failed") return { status: "error", detail: sanitizeDetail(messageOf(body) ?? "ARCA devolvió un error.") };
    return { status: "in_process" };
  }

  #backoff(attempt: number, retryAfterHeader: string | null): number {
    const exp = this.#baseDelayMs * 2 ** attempt;
    const jitter = Math.random() * this.#baseDelayMs * 0.25;
    const retryAfter = Number(retryAfterHeader);
    const fromHeader = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 0;
    return Math.max(exp + jitter, fromHeader);
  }

  /** Manda el pedido. Respuesta 2xx → Response; si no, AfipSdkError (sin bodies). */
  async #send(method: "GET" | "POST", path: string, body: unknown, retry: boolean, secrets: readonly string[]): Promise<Response> {
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
        const data = await res.json().catch(() => null);
        throw new AfipSdkError({ kind: "rejected", status: 400, detail: sanitizeDetail(messageOf(data) ?? "Afip SDK rechazó el pedido.", secrets) });
      }
      await res.body?.cancel().catch(() => {});
      throw new AfipSdkError({ kind: transient ? "unavailable" : "unexpected", status: res.status });
    }
  }
}
