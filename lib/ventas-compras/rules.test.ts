import { describe, expect, it } from "vitest";

import { round2, toCents } from "./money";
import {
  calcularImportes,
  claveArca,
  codigoDeTipo,
  esPesos,
  evaluar,
  MENSAJES,
  monedaSinTipoCambio,
  parseEntero,
  parseFecha,
  parseNumero,
  parseTexto,
  tcAplicado,
} from "./rules";
import type { Contexto, FilaBase } from "./types";

describe("redondeo (ROUND de Excel: mitad lejos del cero, 15 dígitos significativos)", () => {
  // Valores que Excel devuelve con =ROUND(x;2). Math.round(x*100)/100 falla en varios.
  it.each([
    [1.005, 1.01],
    [2.675, 2.68],
    [1.015, 1.02],
    [0.005, 0.01],
    [0.125, 0.13],
    [-1.005, -1.01],
    [-0.005, -0.01],
    [100.01 * 1.5, 150.02], // 150,015
    [100.01 * 1000.5, 100060.01], // 100.060,005
    [1.0049999, 1],
    [1.004999999999999, 1.01], // con 15 dígitos significativos Excel ve 1,00500000000000
    [123456789.125, 123456789.13],
    [0.001, 0],
    [1e-10, 0],
    [0, 0],
  ])("ROUND(%s; 2) = %s", (x, expected) => {
    expect(round2(x)).toBe(expected);
  });

  it("devuelve centavos enteros, sin −0", () => {
    expect(toCents(12.345)).toBe(1235);
    expect(Object.is(toCents(-0.001), 0)).toBe(true);
    expect(() => toCents(Number.NaN)).toThrow();
  });
});

describe("celdas", () => {
  it("Fecha: número de serie de Excel o texto DD/MM/AAAA (también AAAA-MM-DD)", () => {
    expect(parseFecha(46310)).toBe("2026-10-15"); // =FECHA(2026;10;15) en Excel
    expect(parseFecha(46310.75)).toBe("2026-10-15"); // la hora se descarta
    expect(parseFecha(45658)).toBe("2025-01-01");
    expect(parseFecha("15/10/2026")).toBe("2026-10-15");
    expect(parseFecha(" 1/2/2026 ")).toBe("2026-02-01");
    expect(parseFecha("2026-10-15")).toBe("2026-10-15");
    expect(parseFecha("31/02/2026")).toBeNull();
    expect(parseFecha("hoy")).toBeNull();
    expect(parseFecha(null)).toBeNull();
  });

  it("números: de Excel o texto es-AR; vacío = null; inválido = NaN", () => {
    expect(parseNumero(1234.56)).toBe(1234.56);
    expect(parseNumero("1.234,56")).toBe(1234.56);
    expect(parseNumero("1234,56")).toBe(1234.56);
    expect(parseNumero("-15,5")).toBe(-15.5);
    expect(parseNumero("1.234.567")).toBe(1234567);
    expect(parseNumero("1234.5")).toBe(1234.5);
    expect(parseNumero("")).toBeNull();
    expect(parseNumero("  ")).toBeNull();
    expect(parseNumero(null)).toBeNull();
    expect(parseNumero("12abc")).toBeNaN();
    expect(parseNumero("1,234.56")).toBeNaN();
  });

  it("enteros sin ceros a la izquierda; texto sin notación científica", () => {
    expect(parseEntero("00002")).toBe(2);
    expect(parseEntero(12)).toBe(12);
    expect(parseEntero("1,5")).toBeNaN();
    expect(parseEntero(-1)).toBeNaN();
    expect(parseTexto(20123456786)).toBe("20123456786");
    expect(parseTexto(76123456789012)).toBe("76123456789012");
    expect(parseTexto("  QA  ")).toBe("QA");
  });
});

describe("reglas", () => {
  it("Código comprobante = texto del Tipo hasta el primer espacio", () => {
    expect(codigoDeTipo("11 - Factura C")).toBe(11);
    expect(codigoDeTipo("201 - Factura de Crédito Electrónica MiPyMEs A")).toBe(201);
    expect(codigoDeTipo("011 - Factura C")).toBe(11);
    expect(codigoDeTipo(6)).toBe(6);
    expect(codigoDeTipo("Factura C")).toBeNull();
    expect(codigoDeTipo("")).toBeNull();
  });

  it("TC = Tipo Cambio si es > 0; si no, 1", () => {
    expect(tcAplicado(1050.5)).toBe(1050.5);
    expect(tcAplicado(0)).toBe(1);
    expect(tcAplicado(-3)).toBe(1);
    expect(tcAplicado(null)).toBe(1);
  });

  it("Moneda: pesos = «$», «PES» o vacío (sin distinguir mayúsculas, con espacios)", () => {
    for (const m of ["$", "PES", "pes", " Pes ", "", null, undefined]) expect(esPesos(m)).toBe(true);
    for (const m of ["DOL", "USD", "EUR", "US$"]) expect(esPesos(m)).toBe(false);
    expect(monedaSinTipoCambio("DOL", null)).toBe(true);
    expect(monedaSinTipoCambio("DOL", 0)).toBe(true);
    expect(monedaSinTipoCambio("DOL", -1)).toBe(true);
    expect(monedaSinTipoCambio("DOL", 1000)).toBe(false);
    expect(monedaSinTipoCambio("$", null)).toBe(false);
  });

  it("Clave ARCA: Código|PV|Número|documento solo con dígitos", () => {
    expect(claveArca(11, 2, 1234, "20-12345678-6")).toBe("11|2|1234|20123456786");
    expect(claveArca(6, 1, 7, "0")).toBe("6|1|7|0");
  });
});

/**
 * Criterio de aceptación 5: Neto $ contra los valores que dan las fórmulas del Excel
 * (=ROUND(Imp. Total*TC;2)*Signo, etc.), calculados a mano con ROUND de Excel.
 */
describe("importes en pesos (fórmulas del Excel)", () => {
  it.each([
    // impTotal, totalIva, otros, tc, signo → total, iva, neto
    ["Factura C en pesos", 1000, null, null, 1, 1, 1000, 0, 1000],
    ["Factura A con IVA 21 %", 1210, 210, null, 1, 1, 1210, 210, 1000],
    ["Nota de crédito (signo −1)", 605.5, 105.5, null, 1, -1, -605.5, -105.5, -500],
    ["Otros tributos", 1500, 210, 290, 1, 1, 1500, 210, 1000],
    ["USD con TC y .005 en el total", 100.01, 17.36, 0.5, 1000.5, 1, 100060.01, 17368.68, 82191.08],
    ["TC 1,5: 150,015 → 150,02", 100.01, 0, 0, 1.5, 1, 150.02, 0, 150.02],
    ["1,005 en pesos → 1,01", 1.005, 0, 0, 1, 1, 1.01, 0, 1.01],
    ["NC en USD", 200, 42, 0, 950.25, -1, -190050, -39910.5, -150139.5],
    ["tipo no reconocido (signo 0)", 1000, 210, 0, 1, 0, 0, 0, 0],
  ])("%s", (_name, imp, iva, otros, tc, signo, total, ivaPesos, neto) => {
    const r = calcularImportes(imp as number, iva as number | null, otros as number | null, tc as number, signo as number);
    expect(r.total / 100).toBe(total);
    expect(r.iva / 100).toBe(ivaPesos);
    expect(r.neto / 100).toBe(neto);
    expect(r.neto).toBe(r.total - r.iva - r.otros);
  });

  it("celdas vacías = 0", () => {
    expect(calcularImportes(null, null, null, 1, 1)).toEqual({ total: 0, iva: 0, otros: 0, neto: 0 });
  });
});

// ── Control ──────────────────────────────────────────────────────────────────

const fila = (over: Partial<FilaBase> = {}): FilaBase => ({
  fila: 4,
  clave: "11|2|1|30000000007",
  estado: "nueva",
  error: null,
  datos: {},
  codigo: 11,
  signo: 1,
  tipoComprobanteId: "recTIPO0000000011",
  importes: { total: 121000, iva: 21000, otros: 0, neto: 100000 },
  mesFecha: "2026-10-01",
  clientePorCuit: null,
  proveedor: null,
  ...over,
});

const ctx: Contexto = {
  proyectos: [
    { id: "recPROY000000000A", codigo: "QA - Web", activo: true, cliente: { id: "recCLI0000000000A", nombre: "QA Cliente" }, unidadNegocio: "recUN00000000000A" },
    { id: "recPROY000000000S", codigo: "QS - Sin cliente", activo: true, cliente: null, unidadNegocio: null },
  ],
  unidades: [{ id: "recUN00000000000A", nombre: "Consultoría" }, { id: "recUN00000000000B", nombre: "Software" }],
  categorias: [
    { id: "recCATINGRP00000A", nombre: "Ingresos por servicios", tipo: "Ingreso", requiereProyecto: true },
    { id: "recCATINGR000000B", nombre: "Otros ingresos", tipo: "Ingreso", requiereProyecto: false },
    { id: "recCATGASTP00000C", nombre: "Honorarios (proyectos)", tipo: "Gasto", requiereProyecto: true },
    { id: "recCATGAST000000D", nombre: "Gastos varios", tipo: "Gasto", requiereProyecto: false },
  ],
  socios: [{ id: "recSOCIO00000000A", nombre: "LR · Luciano" }],
  categoriaVentasPorDefecto: { nombre: "Ingresos por servicios", id: "recCATINGRP00000A" },
};
const cliente = { id: "recCLI0000000000B", nombre: "Por CUIT" };

describe("Control de Ventas (orden de la columna CONTROL)", () => {
  const v = (f: Partial<FilaBase>, ed = {}, c: Contexto = ctx) => evaluar("ventas", fila(f), ed, c);

  it.each([
    ["tipo no reconocido gana sobre todo", { signo: 0 }, { proyecto: "recNOEXISTE00000X" }, ctx, MENSAJES.tipoNoReconocido],
    ["categoría inexistente (elegida)", {}, { categoria: "recNOEXISTE00000X" }, ctx, MENSAJES.categoriaInexistente],
    ["categoría inexistente (Parámetro sin categoría)", {}, {}, { ...ctx, categoriaVentasPorDefecto: { nombre: "No existe", id: null } }, MENSAJES.categoriaInexistente],
    ["categoría inexistente (sin Parámetro)", {}, {}, { ...ctx, categoriaVentasPorDefecto: { nombre: null, id: null } }, MENSAJES.categoriaInexistente],
    ["la categoría no es de ingreso", {}, { categoria: "recCATGAST000000D" }, ctx, MENSAJES.noEsIngreso],
    ["proyecto inexistente", {}, { proyecto: "recNOEXISTE00000X" }, ctx, MENSAJES.proyectoInexistente],
    ["falta proyecto (categoría por defecto requiere proyecto)", { clientePorCuit: cliente }, {}, ctx, MENSAJES.faltaProyecto],
    ["sin cliente identificado", {}, { categoria: "recCATINGR000000B" }, ctx, MENSAJES.sinCliente],
    ["proyecto sin cliente → sin cliente", {}, { proyecto: "recPROY000000000S" }, ctx, MENSAJES.sinCliente],
    ["OK con cliente por CUIT", { clientePorCuit: cliente }, { categoria: "recCATINGR000000B" }, ctx, MENSAJES.ok],
    ["OK con proyecto", {}, { proyecto: "recPROY000000000A" }, ctx, MENSAJES.ok],
  ])("%s", (_n, f, ed, c, expected) => {
    expect(v(f as Partial<FilaBase>, ed, c as Contexto).control).toBe(expected);
  });

  it("Cliente del proyecto (aunque haya uno por CUIT); UN del proyecto; Mes devengado por defecto", () => {
    const ev = v({ clientePorCuit: cliente }, { proyecto: "recPROY000000000A" });
    expect(ev.cliente).toEqual({ id: "recCLI0000000000A", nombre: "QA Cliente" });
    expect(ev.unidadNegocio).toBe("recUN00000000000A");
    expect(ev.mesDevengado).toBe("2026-10-01");
    expect(ev.categoria).toBe("recCATINGRP00000A");
    const ed = v({}, { proyecto: "recPROY000000000A", unidadNegocio: "recUN00000000000B", mesDevengado: "2026-09" });
    expect(ed.unidadNegocio).toBe("recUN00000000000B");
    expect(ed.mesDevengado).toBe("2026-09-01");
  });
});

describe("Control de Compras (orden de la columna CONTROL)", () => {
  const proveedor = (categoriaPorDefecto: string | null) => ({ id: "recPROV0000000000", nombre: "QA Proveedor", cuit: "30000000007", categoriaPorDefecto });
  const c = (f: Partial<FilaBase>, ed = {}) => evaluar("compras", fila({ proveedor: proveedor(null), ...f }), ed, ctx);

  it.each([
    ["tipo no reconocido", { signo: 0 }, { socio: "recNOEXISTE00000X" }, MENSAJES.tipoNoReconocido],
    ["socio inexistente", {}, { socio: "recNOEXISTE00000X" }, MENSAJES.socioInexistente],
    ["falta categoría (sin socio)", {}, {}, MENSAJES.faltaCategoria],
    ["falta categoría (la del proveedor se borró a mano)", { proveedor: proveedor("recCATGAST000000D") }, { categoria: "" }, MENSAJES.faltaCategoria],
    ["categoría inexistente", {}, { categoria: "recNOEXISTE00000X" }, MENSAJES.categoriaInexistente],
    ["la categoría no es de gasto", {}, { categoria: "recCATINGR000000B" }, MENSAJES.noEsGasto],
    ["proyecto inexistente", {}, { categoria: "recCATGAST000000D", proyecto: "recNOEXISTE00000X" }, MENSAJES.proyectoInexistente],
    ["falta proyecto (categoría requiere proyecto, sin socio)", {}, { categoria: "recCATGASTP00000C" }, MENSAJES.faltaProyecto],
    ["con socio y sin categoría → OK", {}, { socio: "recSOCIO00000000A" }, MENSAJES.ok],
    ["con socio y categoría que requiere proyecto → OK", {}, { socio: "recSOCIO00000000A", categoria: "recCATGASTP00000C" }, MENSAJES.ok],
    ["categoría por defecto del proveedor → OK", { proveedor: proveedor("recCATGAST000000D") }, {}, MENSAJES.ok],
    ["OK con proyecto", {}, { categoria: "recCATGASTP00000C", proyecto: "recPROY000000000A" }, MENSAJES.ok],
  ])("%s", (_n, f, ed, expected) => {
    expect(c(f as Partial<FilaBase>, ed).control).toBe(expected);
  });

  it("Impacto en resultados = −Neto sin socio; a cuenta del socio = Neto con socio", () => {
    expect(c({}, {})).toMatchObject({ impactoResultados: -100000, cuentaSocio: 0 });
    expect(c({}, { socio: "recSOCIO00000000A" })).toMatchObject({ impactoResultados: 0, cuentaSocio: 100000 });
    const nc = c({ importes: { total: -121000, iva: -21000, otros: 0, neto: -100000 } }, {});
    expect(nc.impactoResultados).toBe(100000);
  });

  it("la categoría por defecto del proveedor se usa salvo que el usuario elija otra", () => {
    expect(c({ proveedor: proveedor("recCATGAST000000D") }, {}).categoria).toBe("recCATGAST000000D");
    expect(c({ proveedor: proveedor("recCATGAST000000D") }, { categoria: "recCATGASTP00000C" }).categoria).toBe("recCATGASTP00000C");
    expect(c({ proveedor: proveedor("recCATGAST000000D") }, { categoria: "" }).categoria).toBeNull();
  });
});
