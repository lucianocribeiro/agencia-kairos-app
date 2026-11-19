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

/**
 * Encabezados REALES de la respuesta de Afip SDK para Ventas (t=E), en el orden en que llegan
 * (primera sincronización real, CC-F5-07). Los nombres no son sensibles; los valores de
 * `afipRowVentasReal` son sintéticos.
 */
export const AFIP_VENTAS_COLUMNAS_REALES = [
  "Fecha de Emisión",
  "Tipo de Comprobante",
  "Punto de Venta",
  "Número Desde",
  "Número Hasta",
  "Cód. Autorización",
  "Tipo Doc. Receptor",
  "Nro. Doc. Receptor",
  "Denominación Receptor",
  "Tipo Cambio",
  "Moneda",
  "Imp. Neto Gravado IVA 0%",
  "IVA 2,5%",
  "Imp. Neto Gravado IVA 2,5%",
  "IVA 5%",
  "Imp. Neto Gravado IVA 5%",
  "IVA 10,5%",
  "Imp. Neto Gravado IVA 10,5%",
  "IVA 21%",
  "Imp. Neto Gravado IVA 21%",
  "IVA 27%",
  "Imp. Neto Gravado IVA 27%",
  "Imp. Neto Gravado Total",
  "Imp. Neto No Gravado",
  "Imp. Op. Exentas",
  "Otros Tributos",
  "Total IVA",
  "Imp. Total",
];

/** Fila de Ventas con los nombres reales (valores sintéticos; importes con coma decimal). */
export function afipRowVentasReal(over: AfipRow = {}): AfipRow {
  const values: AfipRow = {
    "Fecha de Emisión": "15/10/2026",
    "Tipo de Comprobante": "1 - Factura A",
    "Punto de Venta": "3",
    "Número Desde": "77",
    "Número Hasta": "77",
    "Cód. Autorización": "76123456789012",
    "Tipo Doc. Receptor": "CUIT",
    "Nro. Doc. Receptor": "30000000007",
    "Denominación Receptor": "QA Cliente",
    "Tipo Cambio": "1,00",
    Moneda: "$",
    "Imp. Neto Gravado IVA 0%": "10,00",
    "IVA 2,5%": "0,25",
    "Imp. Neto Gravado IVA 2,5%": "10,00",
    "IVA 5%": "0,50",
    "Imp. Neto Gravado IVA 5%": "10,00",
    "IVA 10,5%": "1,05",
    "Imp. Neto Gravado IVA 10,5%": "10,00",
    "IVA 21%": "210,00",
    "Imp. Neto Gravado IVA 21%": "1000,00",
    "IVA 27%": "2,70",
    "Imp. Neto Gravado IVA 27%": "10,00",
    "Imp. Neto Gravado Total": "1050,00",
    "Imp. Neto No Gravado": "0,00",
    "Imp. Op. Exentas": "0,00",
    "Otros Tributos": "0,00",
    "Total IVA": "214,50",
    "Imp. Total": "1264,50",
  };
  return Object.fromEntries(AFIP_VENTAS_COLUMNAS_REALES.map((k) => [k, k in over ? over[k] : values[k]]));
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
