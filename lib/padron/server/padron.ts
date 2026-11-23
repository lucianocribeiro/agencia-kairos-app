import "server-only";

import type { ServiceResult } from "@/lib/abm/types";
import { getAirtableClient } from "@/lib/airtable/client";
import { TABLES } from "@/lib/airtable/schema";
import { AfipSdkError, AfipSdkTransport, readJsonCapped, type AfipSdkClientOptions } from "@/lib/arca/server/afipsdk";
import { getArcaConfig } from "@/lib/arca/server/config";
import { parseCuit } from "@/lib/cuit";
import { PARAMS } from "@/lib/factura/factura";
import { decodePem } from "@/lib/factura/server/config";
import { mapPersona, PADRON_MESSAGES, PADRON_REQUEST_KEYS, type PadronDatos, type PadronStatus } from "../padron";

/**
 * Padrón de ARCA (F5-05 · CC-F5-18): ws_sr_constancia_inscripcion · getPersona_v2 vía el
 * transporte compartido de Afip SDK (/afip/auth + /afip/requests).
 *
 * - Ambiente "prod" SIEMPRE (servicio de solo lectura; el padrón de dev solo tiene datos de
 *   prueba), con AFIP_CERT_B64/AFIP_KEY_B64 (mismo decodificado y validación que la factura),
 *   independiente de AFIP_WSFE_ENV.
 * - cuitRepresentada = Parámetros «CUIT»; idPersona = la CUIT del cliente (lib/cuit.ts).
 * - No configurado (sin token, certificado/clave inválidos o Parámetros «CUIT» vacía o
 *   inválida) → 503 con el motivo; el formulario recibe solo {configured, motivo}.
 * - Las dos llamadas son lecturas: se reintentan con el backoff del transporte.
 * - Nunca escribe en Airtable (solo lee Parámetros). Nada se loguea acá: los AfipSdkError
 *   llegan a apiRoute, que loguea solo {kind, status}. Nunca el token, el certificado, la
 *   clave, el TA ni bodies.
 */

const WSID = "ws_sr_constancia_inscripcion";
const PA = TABLES.parametros.fields;

export interface PadronConfig {
  token: string;
  baseUrl: string;
  cert: string;
  key: string;
  /** Parámetros «CUIT», 11 dígitos. */
  cuitRepresentada: string;
}

export type PadronConfigResult = { ok: true; config: PadronConfig } | { ok: false; motivo: string };

/** Parámetros «CUIT» (lectura de Parámetros; un AirtableError se propaga). */
async function cuitDeParametros(): Promise<string> {
  const rows = await getAirtableClient().list(TABLES.parametros.id, { fields: [PA.concepto, PA.valor] });
  const row = rows.find((r) => typeof r.fields[PA.concepto] === "string" && (r.fields[PA.concepto] as string).trim() === PARAMS.cuit);
  return typeof row?.fields[PA.valor] === "string" ? (row.fields[PA.valor] as string) : "";
}

/** Configuración del padrón. Las variables se leen en cada llamada (perezoso). */
export async function getPadronConfig(): Promise<PadronConfigResult> {
  const arca = getArcaConfig();
  if (!arca) return { ok: false, motivo: PADRON_MESSAGES.sinToken };
  const cert = decodePem(process.env.AFIP_CERT_B64, "certificate");
  const key = decodePem(process.env.AFIP_KEY_B64, "key");
  if (!cert || !key) return { ok: false, motivo: PADRON_MESSAGES.sinCertificado };
  const parsed = parseCuit(await cuitDeParametros());
  if (!("digits" in parsed)) return { ok: false, motivo: PADRON_MESSAGES.sinCuitEmpresa };
  return { ok: true, config: { token: arca.token, baseUrl: arca.baseUrl, cert, key, cuitRepresentada: parsed.digits } };
}

/** Lo único que llega al navegador. Si Parámetros no se puede leer, no configurado con ese motivo. */
export async function getPadronStatus(): Promise<PadronStatus> {
  try {
    const r = await getPadronConfig();
    return r.ok ? { configured: true, motivo: null } : { configured: false, motivo: r.motivo };
  } catch {
    return { configured: false, motivo: PADRON_MESSAGES.sinParametros };
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Mensaje de un 400 de Afip SDK (data.message o message), solo para compararlo. Nunca se loguea ni se devuelve. */
function providerMessage(body: unknown): string {
  if (!isObj(body)) return "";
  if (isObj(body.data) && typeof body.data.message === "string") return body.data.message;
  return typeof body.message === "string" ? body.message : "";
}

/** ARCA: «No existe persona con ese Id» (SOAP fault que Afip SDK devuelve como 400). */
export const NO_EXISTE_RE = /no existe persona/i;

/** Marca de «no figura»: un 400 del proveedor con el texto de ARCA, o personaReturn vacío. */
class NoFigura extends AfipSdkError {
  constructor() {
    super({ kind: "rejected", status: 400 });
  }
}

export class PadronClient {
  readonly #transport: AfipSdkTransport;
  readonly #config: PadronConfig;

  constructor(config: PadronConfig, options: Omit<AfipSdkClientOptions, "token" | "baseUrl"> = {}) {
    this.#config = config;
    this.#transport = new AfipSdkTransport({ ...options, token: config.token, baseUrl: config.baseUrl });
  }

  async #auth(): Promise<{ token: string; sign: string }> {
    const res = await this.#transport.send(
      "POST",
      "/afip/auth",
      { environment: "prod", tax_id: this.#config.cuitRepresentada, wsid: WSID, cert: this.#config.cert, key: this.#config.key },
      { retry: true, onBadRequest: () => new AfipSdkError({ kind: "rejected", status: 400, detail: PADRON_MESSAGES.rechazo }) },
    );
    const data = await readJsonCapped(res);
    if (!isObj(data) || typeof data.token !== "string" || typeof data.sign !== "string" || !data.token || !data.sign) throw new AfipSdkError({ kind: "unexpected", status: res.status });
    return { token: data.token, sign: data.sign };
  }

  /** getPersona_v2 de una CUIT. null = no figura en el padrón. */
  async getPersona(idPersona: string): Promise<unknown | null> {
    const ta = await this.#auth();
    try {
      const res = await this.#transport.send(
        "POST",
        "/afip/requests",
        {
          environment: "prod",
          method: "getPersona_v2",
          wsid: WSID,
          params: { token: ta.token, sign: ta.sign, cuitRepresentada: Number(this.#config.cuitRepresentada), idPersona: Number(idPersona) },
        },
        {
          retry: true,
          onBadRequest: (data) => (NO_EXISTE_RE.test(providerMessage(data)) ? new NoFigura() : new AfipSdkError({ kind: "rejected", status: 400, detail: PADRON_MESSAGES.rechazo })),
        },
      );
      return await readJsonCapped(res);
    } catch (err) {
      if (err instanceof NoFigura) return null;
      throw err;
    }
  }
}

export interface PadronDeps {
  /** Para tests: el cliente (con fetch falso). */
  padron?: (config: PadronConfig) => PadronClient;
}

const fail = <T>(status: 400 | 404 | 503, error: string): ServiceResult<T> => ({ ok: false, status, error });

/** POST /api/admin/clientes/padron. Body estricto {cuit}. Nunca escribe en Airtable. */
export async function consultarPadron(body: Record<string, unknown>, deps: PadronDeps = {}): Promise<ServiceResult<PadronDatos>> {
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== PADRON_REQUEST_KEYS[0] || typeof body.cuit !== "string") return fail(400, PADRON_MESSAGES.formato);
  const parsed = parseCuit(body.cuit);
  if (!("digits" in parsed)) return fail(400, parsed.error);

  const cfg = await getPadronConfig();
  if (!cfg.ok) return fail(503, cfg.motivo);
  const client = deps.padron?.(cfg.config) ?? new PadronClient(cfg.config);
  const raw = await client.getPersona(parsed.digits);
  const mapped = raw === null ? ({ found: false } as const) : mapPersona(raw);
  if (!mapped.found) return fail(404, PADRON_MESSAGES.noEncontrada);
  const { razonSocial, domicilio, condicionIva, avisos } = mapped;
  return { ok: true, data: { razonSocial, domicilio, condicionIva, avisos } };
}
