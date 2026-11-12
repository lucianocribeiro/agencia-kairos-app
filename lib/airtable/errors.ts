import "server-only";

export type AirtableErrorCode =
  | "invalid_input" // validación local antes de llamar a la API
  | "computed_field_write"
  | "read_only_field_write"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "unexpected";

/**
 * Error tipado de Airtable.
 *
 * Nunca contiene el token, headers, URL ni el body del request: es seguro
 * loguearlo o serializarlo. Para mostrar algo al usuario usá un texto propio
 * según `code`, no `message`.
 */
export class AirtableError extends Error {
  readonly code: AirtableErrorCode;
  /** Status HTTP (0 si no hubo respuesta). */
  readonly status: number;
  /** `error.type` que devuelve Airtable, si lo hay (p. ej. INVALID_VALUE_FOR_COLUMN). */
  readonly airtableType: string | undefined;

  constructor(init: {
    code: AirtableErrorCode;
    message: string;
    status?: number;
    airtableType?: string;
  }) {
    super(init.message);
    this.name = "AirtableError";
    this.code = init.code;
    this.status = init.status ?? 0;
    this.airtableType = init.airtableType;
  }

  get retryable(): boolean {
    return this.code === "rate_limited" || this.code === "server_error" || this.code === "network_error";
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      airtableType: this.airtableType,
      message: this.message,
    };
  }
}

export function codeForStatus(status: number): AirtableErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400 || status === 413 || status === 422) return "invalid_request";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "unexpected";
}

const MAX_MESSAGE_LENGTH = 300;

/** Limpia un mensaje de la API: saca cualquier secreto conocido y lo acorta. */
export function sanitizeMessage(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redactado]");
  }
  // Por las dudas, cualquier cosa con forma de token personal de Airtable.
  out = out.replace(/\bpat[A-Za-z0-9]{14}\.[A-Za-z0-9]+/g, "[redactado]");
  return out.length > MAX_MESSAGE_LENGTH ? `${out.slice(0, MAX_MESSAGE_LENGTH)}…` : out;
}
