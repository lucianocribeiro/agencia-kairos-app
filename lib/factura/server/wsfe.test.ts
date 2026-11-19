import { describe, expect, it } from "vitest";

import { AfipSdkError } from "@/lib/arca/server/afipsdk";
import { decodePem, type FacturaConfig } from "./config";
import { parseCae, resultOf, WsfeClient } from "./wsfe";

const DEV: FacturaConfig = { token: "tok", baseUrl: "https://afip.test/api/v1", environment: "dev", ambiente: "Homologación", cert: null, key: null, cuitFija: "20409378472" };
const AUTH = { token: "T", sign: "S" };

function client(replies: (Response | "network")[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    const r = replies.shift() ?? new Response("{}", { status: 500 });
    if (r === "network") throw new TypeError("fetch failed");
    return r;
  }) as unknown as typeof fetch;
  return { c: new WsfeClient(DEV, { fetch: fetchImpl, sleep: async () => {} }), calls };
}

describe("WSFE vía Afip SDK (CC-F5-10)", () => {
  it("auth: POST /afip/auth {environment, tax_id, wsid} sin cert/key en dev; respuesta sin token → unexpected", async () => {
    const { c, calls } = client([Response.json({ token: "a", sign: "b", expiration: "x" }), Response.json({ expiration: "x" })]);
    expect(await c.auth("20409378472")).toEqual({ token: "a", sign: "b" });
    expect(calls[0]).toEqual({ url: "https://afip.test/api/v1/afip/auth", body: { environment: "dev", tax_id: "20409378472", wsid: "wsfe" } });
    await expect(c.auth("20409378472")).rejects.toMatchObject({ kind: "unexpected" });
  });

  it("lecturas se reintentan (5xx, red); FECAESolicitar nunca", async () => {
    const ok = Response.json({ FECompUltimoAutorizadoResult: { CbteNro: 7 } });
    const r1 = client([new Response("", { status: 503 }), "network", ok]);
    expect(await r1.c.ultimoAutorizado(AUTH, "20409378472", 1, 1)).toBe(7);
    expect(r1.calls).toHaveLength(3);
    expect(r1.calls[0].body).toEqual({ environment: "dev", method: "FECompUltimoAutorizado", wsid: "wsfe", params: { Auth: { Token: "T", Sign: "S", Cuit: "20409378472" }, PtoVta: 1, CbteTipo: 1 } });

    for (const falla of [new Response("", { status: 503 }), "network" as const, new Response("", { status: 429 })]) {
      const r2 = client([falla, Response.json({})]);
      const err = await r2.c.solicitarCae(AUTH, "20409378472", { ptoVta: 1, cbteTipo: 1, concepto: 2, docTipo: 80, docNro: 1, cbteNro: 1, cbteFch: 1, fchServDesde: 1, fchServHasta: 1, fchVtoPago: 1, impNeto: 1, impIva: 0.21, impTotal: 1.21, ivaId: 5, condicionIvaReceptorId: 1 }).catch((e) => e);
      expect(err).toBeInstanceOf(AfipSdkError);
      expect(err.kind).toBe("unavailable");
      expect(r2.calls).toHaveLength(1);
    }
  });

  it("400 de Afip SDK → rejected con «400: <mensaje>» limpio; 401 → config", async () => {
    const r = client([Response.json({ message: "Punto\u0007 de venta inválido" }, { status: 400 }), new Response("", { status: 401 })]);
    await expect(r.c.ultimoAutorizado(AUTH, "1", 1, 1)).rejects.toMatchObject({ kind: "rejected", detail: "400: Punto de venta inválido" });
    await expect(r.c.ultimoAutorizado(AUTH, "1", 1, 1)).rejects.toMatchObject({ kind: "config" });
  });

  it("formas de respuesta: envuelta o no, en data, listas como array u objeto", () => {
    const det = { Resultado: "A", CAE: "70000000000001", CAEFchVto: "20261129" };
    for (const body of [
      { FECAESolicitarResult: { FeCabResp: { Resultado: "A" }, FeDetResp: { FECAEDetResponse: [det] } } },
      { FECAESolicitarResult: { FeCabResp: { Resultado: "A" }, FeDetResp: { FECAEDetResponse: det } } },
      { FeCabResp: { Resultado: "A" }, FeDetResp: { FECAEDetResponse: [det] } },
      { data: { FECAESolicitarResult: { FeDetResp: { FECAEDetResponse: det } } } },
    ]) expect(parseCae(body)).toEqual({ resultado: "A", cae: "70000000000001", caeFchVto: "2026-11-29", observaciones: [] });
    // CC-F5-11: un "A" incompleto (sin vencimiento, vencimiento inválido, CAE de 13 dígitos o sin CAE) es inesperado.
    for (const d of [{ ...det, CAEFchVto: undefined }, { ...det, CAEFchVto: "20261332" }, { ...det, CAEFchVto: "" }, { ...det, CAE: "7000000000001" }, { ...det, CAE: undefined }]) {
      expect(() => parseCae({ FECAESolicitarResult: { FeCabResp: { Resultado: "A" }, FeDetResp: { FECAEDetResponse: [d] } } })).toThrow(AfipSdkError);
    }
    expect(parseCae({ FECAESolicitarResult: { FeCabResp: { Resultado: "R" }, Errors: { Err: { Code: 10016, Msg: "Número" } } } })).toEqual({ resultado: "R", lineas: ["10016: Número"] });
    expect(parseCae({ FECAESolicitarResult: { Errors: { Err: [{ Code: 600, Msg: "Token" }] } } })).toEqual({ resultado: "R", lineas: ["600: Token"] });
    for (const bad of [null, "x", { FECAESolicitarResult: { FeDetResp: { FECAEDetResponse: { Resultado: "A", CAE: "corto" } } } }, { FECAESolicitarResult: {} }]) expect(() => parseCae(bad)).toThrow(AfipSdkError);
    expect(resultOf({ a: 1 }, "FEParamGetTiposIva")).toEqual({ a: 1 });
  });

  it("FECompConsultar: 602 → null; ResultGet → los datos a comparar", async () => {
    const r = client([
      Response.json({ FECompConsultarResult: { Errors: { Err: [{ Code: 602, Msg: "No existen datos" }] } } }),
      Response.json({ FECompConsultarResult: { ResultGet: { DocNro: 30712345675, ImpTotal: 121.5, CbteFch: "20261119", CodAutorizacion: "70000000000001", FchVto: "20261129", Resultado: "A" } } }),
    ]);
    expect(await r.c.consultar(AUTH, "1", 1, 1, 9)).toBeNull();
    expect(await r.c.consultar(AUTH, "1", 1, 1, 9)).toEqual({ docNro: "30712345675", impTotal: 121.5, cbteFch: "20261119", cae: "70000000000001", caeFchVto: "20261129", resultado: "A" });
    expect(r.calls[0].body.params).toMatchObject({ FeCompConsReq: { CbteNro: 9, PtoVta: 1, CbteTipo: 1 } });
  });

  it("PEM (CC-F5-11): certificado solo CERTIFICATE; clave PRIVATE KEY / RSA / EC con el mismo rótulo en BEGIN y END", () => {
    const b = (s: string) => Buffer.from(s).toString("base64");
    const pem = (begin: string, end = begin) => `-----BEGIN ${begin}-----\nAAAA\n-----END ${end}-----`;
    for (const l of ["PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY"]) expect(decodePem(b(pem(l)), "key")).toBe(pem(l));
    for (const [begin, end] of [["RSA PRIVATE KEY", "PRIVATE KEY"], ["PRIVATE KEY", "EC PRIVATE KEY"], ["EC PRIVATE KEY", "RSA PRIVATE KEY"], ["ENCRYPTED PRIVATE KEY", "ENCRYPTED PRIVATE KEY"], ["DSA PRIVATE KEY", "DSA PRIVATE KEY"], ["PUBLIC KEY", "PUBLIC KEY"]]) {
      expect(decodePem(b(pem(begin, end)), "key")).toBeNull();
    }
    for (const [begin, end] of [["CERTIFICATE REQUEST", "CERTIFICATE REQUEST"], ["TRUSTED CERTIFICATE", "TRUSTED CERTIFICATE"], ["CERTIFICATE", "PRIVATE KEY"], ["X509 CERTIFICATE", "X509 CERTIFICATE"]]) {
      expect(decodePem(b(pem(begin, end)), "certificate")).toBeNull();
    }
    expect(decodePem(b(pem("CERTIFICATE")), "certificate")).toBe(pem("CERTIFICATE"));
  });

  it("PEM en base64: header válido; cualquier otra cosa → null", () => {
    const cert = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";
    const key = "-----BEGIN RSA PRIVATE KEY-----\r\nBBBB\r\n-----END RSA PRIVATE KEY-----\n";
    const b = (s: string) => Buffer.from(s).toString("base64");
    expect(decodePem(b(cert), "certificate")).toBe(cert);
    expect(decodePem(b(key), "key")).toBe("-----BEGIN RSA PRIVATE KEY-----\nBBBB\n-----END RSA PRIVATE KEY-----");
    for (const [v, k] of [[undefined, "certificate"], ["", "key"], ["a b", "key"], [b("hola"), "certificate"], [b(key), "certificate"], [b(cert), "key"], [`${b(cert)}\n${b(cert)}`, "certificate"]] as const) expect(decodePem(v, k)).toBeNull();
  });
});
