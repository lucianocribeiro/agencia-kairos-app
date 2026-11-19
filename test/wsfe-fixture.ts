/**
 * Afip SDK falso para WSFE (CC-F5-10): un `fetch` que responde /afip/auth y /afip/requests
 * según el `method` del body. Nunca se llama a Afip SDK real. Por defecto se porta como
 * homologación: FECompUltimoAutorizado devuelve el último número, FECAESolicitar autoriza (A)
 * y FECompConsultar devuelve lo autorizado (o el error 602). Las respuestas a medida se encolan
 * con `on(method, ...replies)`; "network" simula una falla de red / timeout.
 */
export type WsfeReply = { status?: number; body?: unknown; raw?: string } | "network";

export interface WsfeRequest {
  path: string;
  body: Record<string, unknown>;
  /** Para ordenar contra el Airtable falso: cuántas llamadas había hecho cuando llegó este pedido. */
  seq: number;
}

export function createFakeWsfe(seq: () => number = () => 0) {
  const requests: WsfeRequest[] = [];
  const queues = new Map<string, WsfeReply[]>();
  const emitidos = new Map<string, { docNro: number; impTotal: number; cbteFch: number; cae: string; vto: string }>();
  let ultimo = 0;
  let caeSeq = 70000000000000;

  const reply = (r: WsfeReply) => {
    if (r === "network") throw new TypeError("fetch failed");
    if (r.raw !== undefined) return new Response(r.raw, { status: r.status ?? 200, headers: { "content-type": "application/json" } });
    return Response.json(r.body ?? {}, { status: r.status ?? 200 });
  };

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    requests.push({ path: url.pathname, body, seq: seq() });
    if (url.pathname.endsWith("/afip/auth")) {
      const q = queues.get("auth");
      if (q?.length) return reply(q.shift()!);
      return Response.json({ expiration: "2030-01-01T00:00:00.000Z", token: "TA-token-fake", sign: "TA-sign-fake" });
    }
    const method = String(body.method);
    const q = queues.get(method);
    if (q?.length) return reply(q.shift()!);
    const params = (body.params ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (method === "FECompUltimoAutorizado") return Response.json({ FECompUltimoAutorizadoResult: { PtoVta: params.PtoVta, CbteTipo: params.CbteTipo, CbteNro: ultimo } });
    if (method === "FECAESolicitar") {
      const det = params.FeCAEReq.FeDetReq.FECAEDetRequest;
      ultimo = det.CbteDesde;
      const cae = String(++caeSeq);
      emitidos.set(`${params.FeCAEReq.FeCabReq.PtoVta}|${det.CbteDesde}`, { docNro: det.DocNro, impTotal: det.ImpTotal, cbteFch: det.CbteFch, cae, vto: "20261129" });
      return Response.json({
        FECAESolicitarResult: {
          FeCabResp: { Cuit: params.Auth.Cuit, PtoVta: params.FeCAEReq.FeCabReq.PtoVta, CbteTipo: 1, Resultado: "A", CantReg: 1 },
          FeDetResp: { FECAEDetResponse: [{ Concepto: det.Concepto, DocTipo: 80, DocNro: det.DocNro, CbteDesde: det.CbteDesde, CbteHasta: det.CbteHasta, CbteFch: String(det.CbteFch), Resultado: "A", CAE: cae, CAEFchVto: "20261129" }] },
        },
      });
    }
    if (method === "FECompConsultar") {
      const r = params.FeCompConsReq;
      const e = emitidos.get(`${r.PtoVta}|${r.CbteNro}`);
      if (!e) return Response.json({ FECompConsultarResult: { Errors: { Err: [{ Code: 602, Msg: "No existen datos en nuestros registros para los parametros ingresados." }] } } });
      return Response.json({ FECompConsultarResult: { ResultGet: { DocTipo: 80, DocNro: e.docNro, CbteDesde: r.CbteNro, CbteHasta: r.CbteNro, CbteFch: String(e.cbteFch), ImpTotal: e.impTotal, CodAutorizacion: e.cae, FchVto: e.vto, Resultado: "A", EmisionTipo: "CAE" } } });
    }
    return Response.json({ [`${method}Result`]: { ResultGet: {} } });
  };

  return {
    fetch: fetchImpl as unknown as typeof fetch,
    requests,
    /** Pedidos a /afip/requests con ese método. */
    calls: (method: string) => requests.filter((r) => r.body.method === method),
    on(method: string, ...replies: WsfeReply[]) {
      queues.set(method, [...(queues.get(method) ?? []), ...replies]);
    },
    /** Simula una factura que ARCA autorizó sin que la app lo supiera (para «Verificar»). */
    autorizarAMano(ptoVta: number, numero: number, d: { docNro: number; impTotal: number; cbteFch: number }) {
      ultimo = Math.max(ultimo, numero);
      emitidos.set(`${ptoVta}|${numero}`, { ...d, cae: String(++caeSeq), vto: "20261129" });
    },
    setUltimo(n: number) {
      ultimo = n;
    },
    reset() {
      requests.length = 0;
      queues.clear();
      emitidos.clear();
      ultimo = 0;
      caeSeq = 70000000000000;
    },
  };
}
