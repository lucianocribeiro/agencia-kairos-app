import "server-only";

import { AfipSdkError, AfipSdkTransport, readJsonCapped, type AfipSdkClientOptions } from "@/lib/arca/server/afipsdk";
import { lineasArca } from "../factura";
import type { FacturaConfig } from "./config";

/**
 * Cliente WSFE vía la API de web services de Afip SDK (CC-F5-10), sobre el transporte
 * compartido (lib/arca/server/afipsdk.ts: tope de 8 MB, timeout, redirect "error", sin bodies
 * en los errores ni en los logs).
 *
 * - POST /afip/auth {environment, tax_id, wsid: "wsfe", cert?, key?} → {token, sign, expiration}
 *   (docs.afipsdk.com/integracion/api.md). Se reintenta.
 * - POST /afip/requests {environment, method, wsid: "wsfe", params: {Auth, …}}
 *   (docs.afipsdk.com/siguientes-pasos/web-services/factura-electronica.md y …/factura-a.md).
 *   Lecturas (FECompUltimoAutorizado, FECompConsultar, FEParamGet*): se reintentan.
 *   FECAESolicitar: NUNCA se reintenta (podría emitir dos facturas).
 *
 * La respuesta de WSFE puede venir envuelta en «<Método>Result» o no, y las listas como array o
 * como objeto único: se aceptan las dos formas. Errores de WSFE (Errors.Err) en una lectura →
 * AfipSdkError "rejected" con las líneas «<Code>: <Msg>» (no hay credenciales en WSFE).
 */

export type WsfeMethod =
  | "FECAESolicitar"
  | "FECompUltimoAutorizado"
  | "FECompConsultar"
  | "FEParamGetTiposIva"
  | "FEParamGetCondicionIvaReceptor"
  | "FEParamGetTiposOpcional"
  | "FEParamGetPtosVenta";

export interface WsfeAuth {
  token: string;
  sign: string;
}

export interface CaeRequest {
  ptoVta: number;
  cbteTipo: number;
  concepto: number;
  docTipo: number;
  docNro: number;
  cbteNro: number;
  /** aaaammdd */
  cbteFch: number;
  fchServDesde: number;
  fchServHasta: number;
  fchVtoPago: number;
  /** Importes con 2 decimales. */
  impNeto: number;
  impIva: number;
  impTotal: number;
  ivaId: number;
  condicionIvaReceptorId: number;
}

export type CaeResult =
  | { resultado: "A"; cae: string; caeFchVto: string | null; observaciones: string[] }
  | { resultado: "R"; lineas: string[] };

export interface ConsultaResult {
  docNro: string;
  impTotal: number | null;
  cbteFch: string;
  cae: string | null;
  caeFchVto: string | null;
  resultado: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string | null => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** El resultado del método: `<Método>Result` (en el body, en `data` o en `response`) o el body mismo. */
export function resultOf(body: unknown, method: WsfeMethod): Obj | null {
  if (!isObj(body)) return null;
  const key = `${method}Result`;
  for (const c of [body, body.data, body.response]) if (isObj(c) && isObj(c[key])) return c[key] as Obj;
  return body;
}

/** Errors.Err / Observaciones.Obs → {code, msg}. */
export function itemsOf(container: unknown, inner: "Err" | "Obs" | "Evt"): { code: string; msg: string }[] {
  if (!isObj(container)) return [];
  return list(container[inner])
    .filter(isObj)
    .map((e) => ({ code: str(e.Code) ?? "?", msg: str(e.Msg) ?? "" }));
}

/** Mensaje de un 400 de Afip SDK (data.message o message), solo para mostrarlo como línea de ARCA. */
function messageOf(body: unknown): string | null {
  if (!isObj(body)) return null;
  if (isObj(body.data) && typeof body.data.message === "string") return body.data.message;
  return typeof body.message === "string" ? body.message : null;
}

export class WsfeClient {
  readonly #transport: AfipSdkTransport;
  readonly #config: FacturaConfig;

  constructor(config: FacturaConfig, options: Omit<AfipSdkClientOptions, "token" | "baseUrl"> = {}) {
    this.#config = config;
    this.#transport = new AfipSdkTransport({ ...options, token: config.token, baseUrl: config.baseUrl });
  }

  /** Ticket de acceso (TA) para el CUIT emisor. Afip SDK lo cachea y lo renueva. */
  async auth(cuit: string): Promise<WsfeAuth> {
    const body: Obj = { environment: this.#config.environment, tax_id: cuit, wsid: "wsfe" };
    if (this.#config.environment === "prod") {
      body.cert = this.#config.cert;
      body.key = this.#config.key;
    }
    const res = await this.#transport.send("POST", "/afip/auth", body, { retry: true, onBadRequest: () => new AfipSdkError({ kind: "rejected", status: 400 }) });
    const data = await readJsonCapped(res);
    if (!isObj(data) || typeof data.token !== "string" || typeof data.sign !== "string" || !data.token || !data.sign) throw new AfipSdkError({ kind: "unexpected", status: res.status });
    return { token: data.token, sign: data.sign };
  }

  /** Un pedido a WSFE. `retry` solo para lecturas. Devuelve el body ya leído (tope de 8 MB). */
  async request(method: WsfeMethod, auth: WsfeAuth, cuit: string, params: Obj, retry: boolean): Promise<unknown> {
    const res = await this.#transport.send(
      "POST",
      "/afip/requests",
      { environment: this.#config.environment, method, wsid: "wsfe", params: { Auth: { Token: auth.token, Sign: auth.sign, Cuit: cuit }, ...params } },
      {
        retry,
        onBadRequest: (data) => {
          const m = messageOf(data);
          return new AfipSdkError({ kind: "rejected", status: 400, detail: m ? lineasArca([{ code: "400", msg: m }]).join("\n") : undefined });
        },
      },
    );
    return readJsonCapped(res);
  }

  /** Lectura: Errors de WSFE → rejected con las líneas. */
  async #read(method: WsfeMethod, auth: WsfeAuth, cuit: string, params: Obj): Promise<Obj> {
    const body = await this.request(method, auth, cuit, params, true);
    const r = resultOf(body, method);
    if (!r) throw new AfipSdkError({ kind: "unexpected" });
    return r;
  }

  /** Último número autorizado (0 si no hay ninguno). */
  async ultimoAutorizado(auth: WsfeAuth, cuit: string, ptoVta: number, cbteTipo: number): Promise<number> {
    const r = await this.#read("FECompUltimoAutorizado", auth, cuit, { PtoVta: ptoVta, CbteTipo: cbteTipo });
    const errores = itemsOf(r.Errors, "Err");
    if (errores.length > 0) throw new AfipSdkError({ kind: "rejected", detail: lineasArca(errores).join("\n") });
    const n = num(r.CbteNro);
    if (n === null || !Number.isInteger(n) || n < 0) throw new AfipSdkError({ kind: "unexpected" });
    return n;
  }

  /** Un comprobante ya emitido, o null si ARCA no lo tiene (error 602). */
  async consultar(auth: WsfeAuth, cuit: string, ptoVta: number, cbteTipo: number, cbteNro: number): Promise<ConsultaResult | null> {
    const r = await this.#read("FECompConsultar", auth, cuit, { FeCompConsReq: { CbteNro: cbteNro, PtoVta: ptoVta, CbteTipo: cbteTipo } });
    const errores = itemsOf(r.Errors, "Err");
    if (errores.some((e) => e.code === "602")) return null;
    if (errores.length > 0) throw new AfipSdkError({ kind: "rejected", detail: lineasArca(errores).join("\n") });
    const g = r.ResultGet;
    if (!isObj(g)) throw new AfipSdkError({ kind: "unexpected" });
    return {
      docNro: str(g.DocNro) ?? "",
      impTotal: num(g.ImpTotal),
      cbteFch: str(g.CbteFch) ?? "",
      cae: str(g.CodAutorizacion),
      caeFchVto: str(g.FchVto),
      resultado: str(g.Resultado),
    };
  }

  /** Lectura de parámetros (smoke y diagnóstico): el resultado tal cual. */
  async param(method: Extract<WsfeMethod, `FEParam${string}`>, auth: WsfeAuth, cuit: string): Promise<Obj> {
    return this.#read(method, auth, cuit, {});
  }

  /**
   * FECAESolicitar de UN comprobante. Nunca se reintenta: una falla de red, timeout, 429/5xx o
   * respuesta ilegible lanza AfipSdkError (unavailable/unexpected) y quien llama marca Incierta.
   */
  async solicitarCae(auth: WsfeAuth, cuit: string, q: CaeRequest): Promise<CaeResult> {
    const body = await this.request(
      "FECAESolicitar",
      auth,
      cuit,
      {
        FeCAEReq: {
          FeCabReq: { CantReg: 1, PtoVta: q.ptoVta, CbteTipo: q.cbteTipo },
          FeDetReq: {
            FECAEDetRequest: {
              Concepto: q.concepto,
              DocTipo: q.docTipo,
              DocNro: q.docNro,
              CbteDesde: q.cbteNro,
              CbteHasta: q.cbteNro,
              CbteFch: q.cbteFch,
              FchServDesde: q.fchServDesde,
              FchServHasta: q.fchServHasta,
              FchVtoPago: q.fchVtoPago,
              ImpTotal: q.impTotal,
              ImpTotConc: 0,
              ImpNeto: q.impNeto,
              ImpOpEx: 0,
              ImpIVA: q.impIva,
              ImpTrib: 0,
              MonId: "PES",
              MonCotiz: 1,
              CondicionIVAReceptorId: q.condicionIvaReceptorId,
              Iva: { AlicIva: [{ Id: q.ivaId, BaseImp: q.impNeto, Importe: q.impIva }] },
            },
          },
        },
      },
      false,
    );
    return parseCae(body);
  }
}

/** Respuesta de FECAESolicitar → A (con CAE) o R (con las líneas). Forma inesperada → unexpected (Incierta). */
export function parseCae(body: unknown): CaeResult {
  const r = resultOf(body, "FECAESolicitar");
  if (!r) throw new AfipSdkError({ kind: "unexpected" });
  const errores = itemsOf(r.Errors, "Err");
  const cab = isObj(r.FeCabResp) ? r.FeCabResp : null;
  const det = isObj(r.FeDetResp) ? list(r.FeDetResp.FECAEDetResponse).find(isObj) : undefined;
  const obs = det ? itemsOf(det.Observaciones, "Obs") : [];
  const resultado = str(det?.Resultado) ?? str(cab?.Resultado);
  const cae = str(det?.CAE);
  if (resultado === "A" && cae && /^\d{14}$/.test(cae)) return { resultado: "A", cae, caeFchVto: str(det?.CAEFchVto), observaciones: lineasArca(obs) };
  if (resultado === "R" || (resultado === null && !det && errores.length > 0)) {
    const lineas = lineasArca([...errores, ...obs]);
    return { resultado: "R", lineas };
  }
  throw new AfipSdkError({ kind: "unexpected" });
}
