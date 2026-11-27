import { describe, expect, it } from "vitest";

import { cuitSintetico } from "@/test/arca-fixture";

import {
  CONDICION_IVA_RECEPTOR_IDS,
  comprobanteLabel,
  detalleSugerido,
  evaluarElegibilidad,
  FACTURA_MESSAGES,
  isoToWsfe,
  ivaIdDe,
  lineasArca,
  nombreArchivoFactura,
  parseDatos,
  parsePuntoVenta,
  periodoDelMes,
  validarEmitir,
  wsfeToIso,
  type ElegibilidadInput,
} from "./factura";

const base = (): ElegibilidadInput => ({
  monedas: ["ARS"],
  proformaIncompleta: false,
  cliente: { condicionIva: "Responsable Inscripto", cuit: cuitSintetico("30", 71234567), razonSocial: "QA S.A.", domicilioComercial: "Calle 1" },
  parametros: new Map([
    ["Empresa", "QA Emisora"],
    ["CUIT", cuitSintetico("30", 70000000)],
    ["Domicilio comercial", "Av. 1"],
    ["Ingresos Brutos", "901-1"],
    ["Inicio de actividades", "2020-03-01"],
    ["Punto de venta web services", "7"],
  ]),
  alicuota: 0.21,
  horasPendientes: 2,
  netoPendiente: 100,
  tipoCambio: null,
  usdPendiente: 0,
  activo: null,
  mesLabel: "10/2026",
  configError: null,
});

describe("factura · reglas puras (CC-F5-10)", () => {
  it("elegible sin motivos; con todos los problemas, todos los motivos", () => {
    expect(evaluarElegibilidad(base())).toEqual([]);
    const todo = evaluarElegibilidad({
      ...base(),
      configError: FACTURA_MESSAGES.noConfigurada,
      monedas: ["ARS", "USD"],
      proformaIncompleta: true,
      cliente: { condicionIva: null, cuit: null, razonSocial: " ", domicilioComercial: null },
      parametros: new Map(),
      alicuota: 0.19,
      horasPendientes: 0,
      activo: { ambiente: "Homologación", estado: "En proceso" },
    });
    expect(todo).toHaveLength(16);
    expect(evaluarElegibilidad({ ...base(), netoPendiente: 0 })).toEqual([FACTURA_MESSAGES.sinImporte]);
  });

  it("Id de IVA de WSFE por alícuota (confirmados con FEParamGetTiposIva); otra alícuota → null", () => {
    expect([0, 0.025, 0.05, 0.105, 0.21, 0.27].map(ivaIdDe)).toEqual([3, 9, 8, 4, 5, 6]);
    for (const r of [0.22, 0.1, 0.2105, 1]) expect(ivaIdDe(r)).toBeNull();
    expect(CONDICION_IVA_RECEPTOR_IDS).toEqual({ "Responsable Inscripto": 1 });
  });

  it("punto de venta 1–99999, fechas de WSFE y período del mes", () => {
    expect(["1", "99999", " 7 "].map(parsePuntoVenta)).toEqual([1, 99999, 7]);
    for (const v of ["0", "100000", "1.5", "-1", "", "a"]) expect(parsePuntoVenta(v)).toBeNull();
    expect(isoToWsfe("2026-11-19")).toBe(20261119);
    expect(wsfeToIso("20261129")).toBe("2026-11-29");
    expect(wsfeToIso(20261129)).toBe("2026-11-29");
    expect(wsfeToIso("2026-11-29")).toBe("2026-11-29");
    expect(wsfeToIso("20261332")).toBeNull();
    expect(periodoDelMes("2028-02")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
  });

  it("pedido estricto", () => {
    const ok = { cliente: "recAAAAAAAAAAAAAA", mes: "2026-10", vencimientoPago: "2026-11-19", detalle: "  Servicios \u0007 10/2026  " };
    expect(validarEmitir(ok, "2026-11-19")).toEqual({ ok: true, data: { ...ok, detalle: "Servicios 10/2026", tipoCambio: null } });
    for (const bad of [{ ...ok, extra: 1 }, { ...ok, cliente: "x" }, { ...ok, mes: "2026-13" }, { ...ok, vencimientoPago: "2026-11-18" }, { ...ok, detalle: "x".repeat(201) }, { ...ok, detalle: 3 }]) {
      expect(validarEmitir(bad, "2026-11-19").ok).toBe(false);
    }
  });

  it("líneas de ARCA, etiqueta, archivo, detalle sugerido y snapshot", () => {
    expect(lineasArca([{ code: "10016", msg: "a\u0000b\n c" }])).toEqual(["10016: a b c"]);
    expect(lineasArca(Array.from({ length: 15 }, (_, i) => ({ code: String(i), msg: "m" })))).toHaveLength(10);
    expect(lineasArca([{ code: "1", msg: "x".repeat(500) }])[0]).toHaveLength(300);
    expect(comprobanteLabel({ puntoVenta: 1, numero: 3, cliente: "QA", mes: "2026-10", ambiente: "Homologación" })).toBe("FA 00001-00000003 · QA · 10/2026 · Homologación");
    expect(nombreArchivoFactura(12, 345)).toBe("Factura_A_00012-00000345.pdf");
    expect(detalleSugerido(["QR - Web", "QR - App"], "10/2026")).toBe("Servicios 10/2026: QR - Web, QR - App");
    expect(detalleSugerido(Array.from({ length: 40 }, (_, i) => `Proyecto ${i}`), "10/2026")).toHaveLength(200);
    expect(parseDatos("no json")).toBeNull();
    expect(parseDatos(JSON.stringify({ version: 2 }))).toBeNull();
  });
});

describe("factura · tipo de cambio (CC-F5-21)", () => {
  it("USD sin TC → «Cargá el tipo de cambio…» (reemplaza «sólo en pesos»); con TC, elegible", () => {
    expect(FACTURA_MESSAGES).not.toHaveProperty("soloPesos");
    const usd = { ...base(), monedas: ["ARS", "USD"] as ("ARS" | "USD")[] };
    expect(evaluarElegibilidad(usd)).toEqual([FACTURA_MESSAGES.faltaTipoCambio]);
    expect(FACTURA_MESSAGES.faltaTipoCambio).toBe("Cargá el tipo de cambio para convertir los importes en USD.");
    expect(evaluarElegibilidad({ ...usd, tipoCambio: 1050.25 })).toEqual([]);
    // Sin USD el TC no importa.
    expect(evaluarElegibilidad({ ...base(), tipoCambio: 1050.25 })).toEqual([]);
  });

  it("«no suman importe» mira los USD convertidos: sin TC y con USD pendientes, el motivo es solo el TC", () => {
    const soloUsd = { ...base(), monedas: ["USD"] as ("ARS" | "USD")[], netoPendiente: 0, usdPendiente: 5000 };
    expect(evaluarElegibilidad(soloUsd)).toEqual([FACTURA_MESSAGES.faltaTipoCambio]);
    // Con TC, el neto ya viene convertido: si es > 0, elegible; si es 0, «no suman importe».
    expect(evaluarElegibilidad({ ...soloUsd, tipoCambio: 1000, netoPendiente: 5_000_000 })).toEqual([]);
    expect(evaluarElegibilidad({ ...soloUsd, tipoCambio: 1000, netoPendiente: 0, usdPendiente: 0 })).toEqual([FACTURA_MESSAGES.sinImporte]);
    // Sin TC y sin USD pendientes (las USD ya facturadas) ni ARS: los dos motivos.
    expect(evaluarElegibilidad({ ...soloUsd, usdPendiente: 0 })).toEqual([FACTURA_MESSAGES.faltaTipoCambio, FACTURA_MESSAGES.sinImporte]);
  });

  it("body: «tipoCambio» opcional (texto es-AR); ausente, null o vacío = sin TC; inválido u otro tipo → 400 con el mensaje", async () => {
    const { TC_MESSAGES } = await import("@/lib/proforma/tipo-cambio");
    const ok = { cliente: "recAAAAAAAAAAAAAA", mes: "2026-10", vencimientoPago: "2026-11-19", detalle: "x" };
    expect(validarEmitir({ ...ok, tipoCambio: "1.050,25" }, "2026-11-19")).toEqual({ ok: true, data: { ...ok, tipoCambio: 1050.25 } });
    expect(validarEmitir({ ...ok, tipoCambio: "1050,2575" }, "2026-11-19")).toMatchObject({ ok: true, data: { tipoCambio: 1050.2575 } });
    for (const v of [undefined, null, "", "  "]) expect(validarEmitir({ ...ok, tipoCambio: v }, "2026-11-19")).toMatchObject({ ok: true, data: { tipoCambio: null } });
    for (const v of ["0", "-1", "1,23456", "1.000.000,01", "abc", 1050, true, ["1"], { v: 1 }]) {
      expect(validarEmitir({ ...ok, tipoCambio: v }, "2026-11-19")).toEqual({ ok: false, error: TC_MESSAGES.invalido });
    }
    // Importes del navegador siguen prohibidos.
    expect(validarEmitir({ ...ok, tipoCambio: "1000", neto: 1 }, "2026-11-19")).toEqual({ ok: false, error: FACTURA_MESSAGES.formato });
  });
});
