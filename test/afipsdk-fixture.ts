/**
 * Filas sintéticas con la forma documentada de Afip SDK («mis-comprobantes») y un Afip SDK
 * falso (fetch) para los tests. CUITs inventados con dígito verificador válido; nada real.
 */
import type { Kind } from "@/lib/ventas-compras/columns";

export type AfipRow = Record<string, string | number | null>;

/** Fila de Afip SDK (nombres documentados; importes como texto con coma decimal). */
export function afipRow(kind: Kind, over: AfipRow = {}): AfipRow {
  const base: AfipRow = {
    "Fecha de Emisión": "15/10/2026",
    "Tipo de Comprobante": "11 - Factura C",
    "Punto de Venta": "2",
    "Número Desde": "1",
    "Número Hasta": "1",
    "Cód. Autorización": "76123456789012",
    "Tipo Cambio": "1,00",
    Moneda: "$",
    "Imp. Neto Gravado": "0,00",
    "Imp. Neto No Gravado": "0,00",
    "Imp. Op. Exentas": "0,00",
    "Otros Tributos": "0,00",
    IVA: "0,00",
    "Imp. Total": "1000,00",
  };
  if (kind === "ventas") {
    Object.assign(base, { "Tipo Doc. Receptor": "CUIT", "Nro. Doc. Receptor": "30000000007", "Denominación Receptor": "QA Cliente" });
  } else {
    Object.assign(base, { "Tipo Doc. Emisor": "CUIT", "Nro. Doc. Emisor": "30000000007", "Denominación Emisor": "QA Proveedor" });
  }
  return { ...base, ...over };
}

export interface AfipRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | "network";

/**
 * Afip SDK falso. `create` y `get` son colas de respuestas (la última se repite). Registra
 * cada pedido (con el body, para verificar qué se mandó y que las credenciales solo van acá).
 */
export function createFakeAfipSdk() {
  const requests: AfipRequest[] = [];
  let createReplies: Reply[] = [{ status: 200, body: { status: "in_process", id: "job-0001" } }];
  let getReplies: Reply[] = [{ status: 200, body: { status: "in_process" } }];
  const next = (queue: Reply[]) => (queue.length > 1 ? queue.shift()! : queue[0]);

  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    requests.push({ method, path: url.pathname, authorization: headers.get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const reply = method === "POST" ? next(createReplies) : next(getReplies);
    if (reply === "network") throw new TypeError("fetch failed");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json", ...reply.headers } });
  };

  return {
    fetch: fetchFn as unknown as typeof fetch,
    requests,
    onCreate(...replies: Reply[]) {
      createReplies = replies;
    },
    onGet(...replies: Reply[]) {
      getReplies = replies;
    },
    /** El job termina con estas filas. */
    complete(rows: unknown[]) {
      getReplies = [{ status: 200, body: { id: "job-0001", status: "complete", data: rows } }];
    },
    reset() {
      requests.length = 0;
      createReplies = [{ status: 200, body: { status: "in_process", id: "job-0001" } }];
      getReplies = [{ status: 200, body: { status: "in_process" } }];
    },
  };
}
