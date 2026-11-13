import { describe, expect, it } from "vitest";

import {
  CONTROL,
  evaluarMovimiento,
  importeConSigno,
  importePesos,
  saldoCorrido,
  tcAplicado,
  TESORERIA_MESSAGES,
  TIPO_TRANSFERENCIA,
  validarMovimiento,
  type MovimientoDatos,
  type TesoreriaCtx,
} from "./rules";

const ARS = { id: "recCUENTAARS0000A", nombre: "QA Banco $", moneda: "ARS" as const, saldoInicial: 1000 };
const USD = { id: "recCUENTAUSD0000B", nombre: "QA Banco U$S", moneda: "USD" as const, saldoInicial: 0 };
const tipo = (id: string, nombre: string, movimiento: "Cobranza" | "Pago" | "Ambos", o: { suma?: boolean; cat?: string | null; tercero?: boolean; socio?: boolean } = {}) => ({
  id,
  nombre,
  movimiento,
  suma: !!o.suma,
  categoriaPorDefecto: o.cat ?? null,
  pideTercero: !!o.tercero,
  esDeSocio: !!o.socio,
});
const ctx: TesoreriaCtx = {
  cuentas: [ARS, USD],
  tipos: [
    tipo("recTIPOCOBRO00000", "Cobro a cliente", "Cobranza", { tercero: true }),
    tipo("recTIPOPAGOPROV00", "Pago a proveedor", "Pago", { tercero: true }),
    tipo("recTIPOBANCARIOS0", "Gastos bancarios", "Pago", { suma: true, cat: "recCATBANCARIOS00" }),
    tipo("recTIPOSINCOMP000", "Gasto sin comprobante", "Pago", { suma: true }),
    tipo("recTIPORETIRO0000", "Retiro de socio", "Pago", { socio: true }),
    tipo("recTIPOOTRO000000", "Otro (no suma a resultados)", "Ambos"),
    tipo("recTIPOTRANSF0000", TIPO_TRANSFERENCIA, "Ambos"),
    tipo("recTIPOCATROTA000", "Con categoría que no existe", "Pago", { suma: true, cat: "recNOEXISTE00000X" }),
  ],
  categorias: [
    { id: "recCATBANCARIOS00", nombre: "Gastos bancarios" },
    { id: "recCATVARIOS00000", nombre: "Gastos varios" },
  ],
  socios: [{ id: "recSOCIO000000000", nombre: "LR · Luciano" }],
  clientes: [{ id: "recCLIENTE0000000", nombre: "QA Cliente" }],
  proveedores: [{ id: "recPROVEEDOR00000", nombre: "QA Proveedor" }],
};

const mov = (over: Partial<MovimientoDatos> = {}): MovimientoDatos => ({
  fecha: "2026-10-15",
  cuenta: ARS.id,
  movimiento: "Pago",
  importe: 100,
  tipoOperacion: "recTIPOOTRO000000",
  cliente: null,
  proveedor: null,
  sumaResultados: null,
  categoria: null,
  socio: null,
  tipoCambio: null,
  descripcion: "",
  transferencia: null,
  ...over,
});
const ev = (over: Partial<MovimientoDatos> = {}) => evaluarMovimiento(mov(over), ctx);

describe("importes", () => {
  it("con signo: + cobranza, − pago (centavos, moneda de la cuenta)", () => {
    expect(importeConSigno({ movimiento: "Cobranza", importe: 1234.56 })).toBe(123456);
    expect(importeConSigno({ movimiento: "Pago", importe: 1234.56 })).toBe(-123456);
    expect(importeConSigno({ movimiento: null, importe: 10 })).toBe(0);
    expect(importeConSigno({ movimiento: "Pago", importe: null })).toBe(0);
  });

  it("TC aplicado: ARS → 1; USD → el tipo de cambio (o null si falta o no es > 0)", () => {
    expect(tcAplicado(ARS, 999)).toBe(1);
    expect(tcAplicado(USD, 1050.25)).toBe(1050.25);
    expect(tcAplicado(USD, null)).toBeNull();
    expect(tcAplicado(USD, 0)).toBeNull();
    expect(tcAplicado(USD, -1)).toBeNull();
  });

  it("Importe $ = ROUND(con signo × TC; 2) con ROUND de Excel (.005 hacia afuera)", () => {
    expect(importePesos({ movimiento: "Cobranza", importe: 100.01, tipoCambio: 1.5 }, USD)).toBe(15002); // 150,015 → 150,02
    expect(importePesos({ movimiento: "Pago", importe: 100.01, tipoCambio: 1.5 }, USD)).toBe(-15002); // −150,015 → −150,02
    expect(importePesos({ movimiento: "Pago", importe: 1234.5, tipoCambio: null }, ARS)).toBe(-123450);
    expect(importePesos({ movimiento: "Cobranza", importe: 10, tipoCambio: null }, USD)).toBeNull();
  });
});

describe("valores efectivos", () => {
  it("Es de socio → Suma N; si no, la del registro; si no, la del tipo", () => {
    expect(ev({ tipoOperacion: "recTIPORETIRO0000", socio: "recSOCIO000000000", sumaResultados: "S" }).suma).toBe("N");
    expect(ev({ tipoOperacion: "recTIPOOTRO000000", sumaResultados: "S", categoria: "recCATVARIOS00000" }).suma).toBe("S");
    expect(ev({ tipoOperacion: "recTIPOBANCARIOS0", sumaResultados: "N" }).suma).toBe("N");
    expect(ev({ tipoOperacion: "recTIPOBANCARIOS0" }).suma).toBe("S");
    expect(ev({ tipoOperacion: "recTIPOOTRO000000" }).suma).toBe("N");
  });

  it("Categoría solo si suma = S: la del registro, si no la del tipo", () => {
    expect(ev({ tipoOperacion: "recTIPOBANCARIOS0" }).categoria).toBe("recCATBANCARIOS00");
    expect(ev({ tipoOperacion: "recTIPOBANCARIOS0", categoria: "recCATVARIOS00000" }).categoria).toBe("recCATVARIOS00000");
    expect(ev({ tipoOperacion: "recTIPOBANCARIOS0", sumaResultados: "N", categoria: "recCATVARIOS00000" }).categoria).toBeNull();
  });

  it("Impacto en resultados = Importe $ si suma S; a cuenta del socio = −Importe $ si es de socio", () => {
    expect(ev({ tipoOperacion: "recTIPOBANCARIOS0", importe: 50 })).toMatchObject({ impacto: -5000, cuentaSocio: 0 });
    expect(ev({ tipoOperacion: "recTIPORETIRO0000", socio: "recSOCIO000000000", importe: 300 })).toMatchObject({ impacto: 0, cuentaSocio: 30000, esDeSocio: true });
    expect(ev({ tipoOperacion: "recTIPOOTRO000000", importe: 300 })).toMatchObject({ impacto: 0, cuentaSocio: 0 });
  });
});

describe("Control (primer mensaje que falla, orden del Excel)", () => {
  it.each([
    ["falta cuenta", { cuenta: null, movimiento: null }, CONTROL.faltaCuenta],
    ["cuenta inexistente", { cuenta: "recNOEXISTE00000X", movimiento: null }, CONTROL.cuentaInexistente],
    ["Cobranza o Pago", { movimiento: null, importe: null }, CONTROL.movimiento],
    ["falta importe", { importe: null, tipoOperacion: null }, CONTROL.faltaImporte],
    ["importe no positivo", { importe: 0 }, CONTROL.faltaImporte],
    ["falta tipo", { tipoOperacion: null }, CONTROL.faltaTipo],
    ["tipo inexistente", { tipoOperacion: "recNOEXISTE00000X" }, CONTROL.tipoInexistente],
    ["tipo debería ser Cobranza", { tipoOperacion: "recTIPOCOBRO00000", movimiento: "Pago" }, "Este tipo debería ser Cobranza"],
    ["tipo debería ser Pago", { tipoOperacion: "recTIPOPAGOPROV00", movimiento: "Cobranza", cliente: "recCLIENTE0000000" }, "Este tipo debería ser Pago"],
    ["falta cliente / proveedor (cobranza)", { tipoOperacion: "recTIPOCOBRO00000", movimiento: "Cobranza" }, CONTROL.faltaTercero],
    ["falta cliente / proveedor (pago)", { tipoOperacion: "recTIPOPAGOPROV00" }, CONTROL.faltaTercero],
    ["falta socio", { tipoOperacion: "recTIPORETIRO0000" }, CONTROL.faltaSocio],
    ["socio en un tipo que no es de socio", { socio: "recSOCIO000000000" }, CONTROL.socioSoloEn],
    ["socio inexistente", { tipoOperacion: "recTIPORETIRO0000", socio: "recNOEXISTE00000X" }, CONTROL.socioInexistente],
    ["falta categoría", { tipoOperacion: "recTIPOSINCOMP000" }, CONTROL.faltaCategoria],
    ["falta categoría (suma S a mano, tipo sin categoría)", { sumaResultados: "S" }, CONTROL.faltaCategoria],
    ["categoría inexistente (del tipo)", { tipoOperacion: "recTIPOCATROTA000" }, CONTROL.categoriaInexistente],
    ["categoría inexistente (del registro)", { tipoOperacion: "recTIPOSINCOMP000", categoria: "recNOEXISTE00000X" }, CONTROL.categoriaInexistente],
    ["falta tipo de cambio (USD)", { cuenta: USD.id }, CONTROL.faltaTc],
    ["falta tipo de cambio (USD, TC 0)", { cuenta: USD.id, tipoCambio: 0 }, CONTROL.faltaTc],
    ["falta tipo de cambio (transferencia USD)", { cuenta: USD.id, tipoOperacion: "recTIPOTRANSF0000", sumaResultados: "N" }, CONTROL.faltaTc],
    ["OK USD con TC", { cuenta: USD.id, tipoCambio: 1000.5 }, CONTROL.ok],
    ["OK cobro a cliente", { tipoOperacion: "recTIPOCOBRO00000", movimiento: "Cobranza", cliente: "recCLIENTE0000000" }, CONTROL.ok],
    ["OK retiro de socio", { tipoOperacion: "recTIPORETIRO0000", socio: "recSOCIO000000000" }, CONTROL.ok],
    ["OK gastos bancarios (categoría del tipo)", { tipoOperacion: "recTIPOBANCARIOS0" }, CONTROL.ok],
  ])("%s", (_n, over, control) => {
    expect(ev(over as Partial<MovimientoDatos>).control).toBe(control);
  });
});

describe("validación del formulario (bloquea todo lo que no es OK, y más)", () => {
  const v = (over: Partial<MovimientoDatos>, opts?: { esTransferencia?: boolean }) => validarMovimiento(mov(over), ctx, opts);

  it("OK → null", () => {
    expect(v({})).toBeNull();
    expect(v({ tipoOperacion: "recTIPOCOBRO00000", movimiento: "Cobranza", cliente: "recCLIENTE0000000" })).toBeNull();
  });

  it("cada Control distinto de OK bloquea con su mensaje", () => {
    expect(v({ tipoOperacion: "recTIPOCOBRO00000", movimiento: "Pago" })).toBe("Este tipo debería ser Cobranza");
    expect(v({ tipoOperacion: "recTIPOPAGOPROV00" })).toBe(CONTROL.faltaTercero);
    expect(v({ socio: "recSOCIO000000000" })).toBe(CONTROL.socioSoloEn);
    expect(v({ cuenta: USD.id })).toBe(CONTROL.faltaTc);
    expect(v({ importe: -5 })).toBe(CONTROL.faltaImporte);
  });

  it.each([
    ["sin fecha", { fecha: null }, TESORERIA_MESSAGES.fecha],
    ["importe con 3 decimales", { importe: 1.234 }, TESORERIA_MESSAGES.importeDecimales],
    ["TC con 5 decimales", { cuenta: USD.id, tipoCambio: 1.23456 }, TESORERIA_MESSAGES.tcDecimales],
    ["suma inválida", { sumaResultados: "X" }, TESORERIA_MESSAGES.suma],
    ["cliente y proveedor a la vez", { cliente: "recCLIENTE0000000", proveedor: "recPROVEEDOR00000" }, TESORERIA_MESSAGES.terceroAmbos],
    ["proveedor en una cobranza", { movimiento: "Cobranza", proveedor: "recPROVEEDOR00000" }, TESORERIA_MESSAGES.terceroCobranza],
    ["cliente en un pago", { cliente: "recCLIENTE0000000" }, TESORERIA_MESSAGES.terceroPago],
    ["cliente inexistente", { movimiento: "Cobranza", cliente: "recNOEXISTE00000X" }, TESORERIA_MESSAGES.clienteInexistente],
    ["proveedor inexistente", { proveedor: "recNOEXISTE00000X" }, TESORERIA_MESSAGES.proveedorInexistente],
    ["categoría inexistente aunque no sume", { categoria: "recNOEXISTE00000X" }, TESORERIA_MESSAGES.categoriaInexistente],
    ["la transferencia no va por este formulario", { tipoOperacion: "recTIPOTRANSF0000" }, TESORERIA_MESSAGES.transferencia],
    ["descripción larga", { descripcion: "x".repeat(2001) }, TESORERIA_MESSAGES.descripcion],
  ])("%s", (_n, over, message) => {
    expect(v(over as Partial<MovimientoDatos>)).toBe(message);
  });

  it("el formulario de transferencia sí puede usar el tipo de transferencia", () => {
    expect(v({ tipoOperacion: "recTIPOTRANSF0000", sumaResultados: "N" }, { esTransferencia: true })).toBeNull();
  });

  it("tercero opcional cuando el tipo no lo pide", () => {
    expect(v({ tipoOperacion: "recTIPOOTRO000000", movimiento: "Cobranza", cliente: "recCLIENTE0000000" })).toBeNull();
  });
});

describe("saldo corrido", () => {
  it("Saldo inicial + Σ con signo, ordenado por Fecha y después N°; saldo inicial vacío = 0", () => {
    const rows = [
      { id: "c", fecha: "2026-10-02", numero: 3, importeSigno: -5000 },
      { id: "a", fecha: "2026-10-01", numero: 7, importeSigno: 20000 },
      { id: "b", fecha: "2026-10-02", numero: 2, importeSigno: 1000 },
    ];
    expect(saldoCorrido(1000, rows).map((x) => [x.mov.id, x.saldo])).toEqual([
      ["a", 120000],
      ["b", 121000],
      ["c", 116000],
    ]);
    expect(saldoCorrido(0, rows).at(-1)!.saldo).toBe(16000);
  });
});
