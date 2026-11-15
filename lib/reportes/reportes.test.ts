import { describe, expect, it } from "vitest";

import { categorias, comprobantes, compras, horas, ID, movimientos, movs, refsPorProyecto, refsSaldos, socios, tesoreriaCtx, ventas } from "@/test/reportes-fixture";
import { indiceMes, mesLabel, parsePrimerMes, PERIODO_MESSAGES, periodoDesde, resolverPeriodo, sumarMeses } from "./periodo";
import { calcularPorProyecto } from "./por-proyecto";
import { calcularResultados, SIN_CATEGORIA } from "./resultados";
import { calcularSaldos } from "./saldos";
import { calcularSocios, situacion } from "./socios";

/** Valores esperados calculados a mano (centavos). Período: feb-2026 … ene-2027. */
const P = periodoDesde("2026-02");
const z = () => Array(12).fill(0);
const at = (pairs: [number, number][]) => {
  const out = z();
  for (const [i, v] of pairs) out[i] = v;
  return out;
};
const MAR = 1;
const ABR = 2;
const MAY = 3;
const JUN = 4;
const JUL = 5;
const ENE27 = 11;

describe("período", () => {
  it("12 meses desde el inicio, ambos extremos incluidos; etiqueta mm/aaaa", () => {
    expect(P.meses).toEqual(["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
    expect(P.label).toBe("Período: 02/2026 a 01/2027");
    expect(mesLabel("2026-01")).toBe("01/2026");
    expect(sumarMeses("2026-12", 1)).toBe("2027-01");
    expect(indiceMes(P, "2027-01-31")).toBe(11);
    expect(indiceMes(P, "2027-02-01")).toBe(-1);
    expect(indiceMes(P, "2026-01-31")).toBe(-1);
    expect(indiceMes(P, null)).toBe(-1);
  });

  it("parámetro AAAA-MM-DD o AAAA-MM; inválido o vacío → enero del año actual con aviso", () => {
    expect(parsePrimerMes("2026-01-01")).toBe("2026-01");
    expect(parsePrimerMes(" 2026-03 ")).toBe("2026-03");
    for (const bad of ["2026-13-01", "2026-02-30", "01/2026", "", null, 202601]) expect(parsePrimerMes(bad), String(bad)).toBeNull();
    expect(resolverPeriodo(null, "2026-01-01", "2026-11-14")).toEqual({ periodo: periodoDesde("2026-01"), aviso: null });
    expect(resolverPeriodo(null, "basura", "2026-11-14")).toEqual({ periodo: periodoDesde("2026-01"), aviso: PERIODO_MESSAGES.parametro });
    expect(resolverPeriodo(null, null, "2027-03-02")).toEqual({ periodo: periodoDesde("2027-01"), aviso: PERIODO_MESSAGES.parametro });
    expect(resolverPeriodo("2026-05", "2026-01-01", "2026-11-14")).toEqual({ periodo: periodoDesde("2026-05"), aviso: null });
    expect(resolverPeriodo("2026-5", null, "2026-11-14")).toEqual({ error: PERIODO_MESSAGES.mes });
  });

  it("rango soportado: mes inicial de 2000-01 a 2099-01 (los 12 meses terminan a más tardar en 2099-12)", () => {
    for (const bad of ["1999-12", "2099-02", "0000-01", "9999-12"]) expect(resolverPeriodo(bad, "2026-01-01", "2026-11-14"), bad).toEqual({ error: PERIODO_MESSAGES.mes });
    expect(resolverPeriodo("2000-01", null, "2026-11-14")).toEqual({ periodo: periodoDesde("2000-01"), aviso: null });
    const fin = resolverPeriodo("2099-01", null, "2026-11-14");
    expect(fin).toMatchObject({ periodo: { desde: "2099-01", hasta: "2099-12", label: "Período: 01/2099 a 12/2099" }, aviso: null });
    expect(PERIODO_MESSAGES.mes).toBe("Elegí un mes válido (AAAA-MM).");
    // parámetro fuera de rango = inválido → enero del año actual con aviso
    for (const param of ["1999-12-01", "2099-02-01", "2099-12", "0000-01-01", "9999-12"]) {
      expect(resolverPeriodo(null, param, "2026-11-14"), param).toEqual({ periodo: periodoDesde("2026-01"), aviso: PERIODO_MESSAGES.parametro });
    }
    expect(parsePrimerMes("2099-01-31")).toBe("2099-01");
    // la cuenta de meses siempre da años de 4 dígitos
    expect(periodoDesde("2000-01").meses.every((m) => /^\d{4}-\d{2}$/.test(m))).toBe(true);
    expect(sumarMeses("2000-01", -1)).toBe("1999-12");
    expect(sumarMeses("0001-01", 0)).toBe("0001-01");
  });
});

describe("datos del fixture (reglas reales)", () => {
  it("NC con signo negativo, USD con TC y otros tributos, socio, cliente efectivo", () => {
    expect(ventas.v2).toMatchObject({ total: -60550, neto: -50000, impacto: -50000, cliente: ID.cli1, categoria: ID.ing1, unidadNegocio: null });
    expect(ventas.v3).toMatchObject({ total: 10006001, neto: 8219108, impacto: 8219108, cliente: null, categoria: ID.gas2 });
    expect(ventas.v1).toMatchObject({ cliente: ID.cli1, unidadNegocio: ID.una, mes: "2026-03" });
    expect(compras.c1).toMatchObject({ impacto: -100000, categoria: ID.gas1, cuentaSocio: 0 });
    expect(compras.c2).toMatchObject({ impacto: -50000, categoria: null });
    expect(compras.c3).toMatchObject({ impacto: 0, cuentaSocio: 30000, socio: ID.s1, categoria: ID.gas1 });
    expect(compras.c4).toMatchObject({ mes: "2026-07", categoria: ID.gas2 });
    expect(movs.t3).toMatchObject({ importeSigno: 10001, importePesos: 10006001, impacto: 10006001, suma: "S" });
    expect(movs.t4).toMatchObject({ suma: "N", impacto: 0 });
    expect(movs.t6).toMatchObject({ impacto: 0, importeSigno: -30000 });
    expect(movs.t8).toMatchObject({ cuentaSocio: 100000, impacto: 0 });
  });
});

describe("Resultados", () => {
  const r = calcularResultados(P, categorias, comprobantes, movimientos);
  const row = (rows: { id: string | null; valores: number[]; total: number }[], id: string) => rows.find((x) => x.id === id)!;

  it("todas las categorías del tipo, también en 0, ordenadas por nombre", () => {
    expect(r.ingresos.map((f) => f.nombre)).toEqual(["Ingresos por servicios", "Otros ingresos"]);
    expect(r.gastos.map((f) => f.nombre)).toEqual(["Alquileres", "Gastos varios", "Honorarios"]);
    expect(row(r.gastos, ID.gas3)).toMatchObject({ valores: z(), total: 0 });
  });

  it("Ingreso = S; Gasto = −S (una Venta con categoría de Gasto resta en esa fila); compras a socio, transferencias y Suma N = 0", () => {
    // Ingresos por servicios: V1 1.000 + NC −500 (mar). V5/V6 fuera del período.
    expect(row(r.ingresos, ID.ing1)).toEqual({ id: ID.ing1, nombre: "Ingresos por servicios", valores: at([[MAR, 50000]]), total: 50000 });
    // Otros ingresos: Tesorería USD 100.060,01 (abr) + V4 100 (ene-2027, mes 12).
    expect(row(r.ingresos, ID.ing2)).toMatchObject({ valores: at([[ABR, 10006001], [ENE27, 10000]]), total: 10016001 });
    // Gastos varios: C1 1.000 + Gastos bancarios 150,75 (mar); C3 (socio) no suma.
    expect(row(r.gastos, ID.gas1)).toMatchObject({ valores: at([[MAR, 115075]]), total: 115075 });
    // Honorarios: Venta USD (neto 82.191,08) → −82.191,08 (abr); C4 200 (jul, Mes devengado guardado).
    expect(row(r.gastos, ID.gas2)).toMatchObject({ valores: at([[ABR, -8219108], [JUL, 20000]]), total: -8199108 });
  });

  it("Sin categoría: compra sin categoría (proveedor sin default) y Tesorería Suma S sin categoría", () => {
    expect(r.sinCategoria).toEqual({ id: null, nombre: SIN_CATEGORIA, valores: at([[ABR, 50000], [MAY, -7000]]), total: 43000 });
  });

  it("totales, Resultado y Margen %", () => {
    expect(r.totalIngresos).toMatchObject({ valores: at([[MAR, 50000], [ABR, 10006001], [ENE27, 10000]]), total: 10066001 });
    expect(r.totalGastos).toMatchObject({ valores: at([[MAR, 115075], [ABR, -8169108], [MAY, -7000], [JUL, 20000]]), total: -8041033 });
    expect(r.resultado).toMatchObject({ valores: at([[MAR, -65075], [ABR, 18175109], [MAY, 7000], [JUL, -20000], [ENE27, 10000]]), total: 18107034 });
    expect(r.margen[MAR]).toBeCloseTo(-65075 / 50000, 12);
    expect(r.margen[MAY]).toBeNull(); // ingresos 0
    expect(r.margen[12]).toBeCloseTo(18107034 / 10066001, 12);
  });

  it("cambiar el mes inicial corre las 12 columnas", () => {
    const r2 = calcularResultados(periodoDesde("2026-03"), categorias, comprobantes, movimientos);
    expect(r2.periodo.label).toBe("Período: 03/2026 a 02/2027");
    // V5 (feb-2027, Ingresos por servicios) entra como mes 12; V4 (ene-2027) pasa a la columna 11.
    expect(row(r2.ingresos, ID.ing1)).toMatchObject({ valores: at([[0, 50000], [11, 10000]]), total: 60000 });
    expect(row(r2.ingresos, ID.ing2).valores).toEqual(at([[1, 10006001], [10, 10000]]));
  });
});

describe("Resultados por UN y por proyecto", () => {
  const d = calcularPorProyecto(P, refsPorProyecto, comprobantes, movimientos, horas);

  it("por unidad de negocio, Sin UN, Tesorería y TOTAL", () => {
    expect(d.unidades).toEqual([
      { id: ID.una, nombre: "Consultoría", ingresos: 110000, gastos: 100000, resultado: 10000, margen: 10000 / 110000 },
      { id: ID.unb, nombre: "Software", ingresos: 0, gastos: 0, resultado: 0, margen: null },
    ]);
    expect(d.sinUnidad).toMatchObject({ ingresos: 8169108, gastos: 70000, resultado: 8099108 });
    // Tesorería: positivos 100.060,01 + 70; negativos −150,75.
    expect(d.tesoreria).toMatchObject({ ingresos: 10013001, gastos: 15075, resultado: 9997926 });
    expect(d.totalUnidades).toMatchObject({ ingresos: 18292109, gastos: 185075, resultado: 18107034 });
  });

  it("por proyecto (todos los estados, por Código), horas del período y Sin proyecto", () => {
    expect(d.proyectos.map((p) => p.nombre)).toEqual(["QA - App", "QA - Web"]);
    expect(d.proyectos[0]).toMatchObject({ id: ID.p2, ingresos: 0, gastos: 0, margen: null, cliente: "QA Cliente Dos", unidadNegocio: null, horas: 0, ingresoPorHora: null });
    expect(d.proyectos[1]).toMatchObject({ id: ID.p1, ingresos: 110000, gastos: 100000, resultado: 10000, cliente: "QA Cliente Uno", unidadNegocio: "Consultoría", horas: 5, ingresoPorHora: 22000 });
    expect(d.sinProyecto).toMatchObject({ nombre: "Sin proyecto", ingresos: 8169108, gastos: 70000, resultado: 8099108, cliente: null, unidadNegocio: null, horas: null });
  });

  it("cambiar el mes inicial cambia qué entra", () => {
    const d2 = calcularPorProyecto(periodoDesde("2026-04"), refsPorProyecto, comprobantes, movimientos, horas);
    // Sin V1, C1 ni la hora de mar; entran V5 (feb-2027, sin proyecto) y la hora de feb-2027 (mes 11).
    expect(d2.proyectos[1]).toMatchObject({ ingresos: 10000, gastos: 0, horas: 3.5, ingresoPorHora: 2857 });
    expect(d2.sinProyecto.ingresos).toBe(8219108 + 10000);
  });
});

describe("Socios", () => {
  const d = calcularSocios(P, socios, tesoreriaCtx.tipos, comprobantes, movimientos);

  it("histórico: retiros, gastos (Tesorería y Compras), aportes, lo que le corresponde y la situación", () => {
    if (!d.ok) throw new Error("faltan tipos");
    expect(d.socios[0]).toEqual({
      id: ID.s1,
      sigla: "LR",
      nombre: "Luciano",
      retiros: 100000,
      gastosTesoreria: 20000, // dic-2025: histórico, aunque esté antes del período
      gastosCompras: 30000,
      aportes: 0,
      totalNeto: 150000,
      porcentaje: 0.6,
      leCorresponde: 126060, // round2(2.101 × 0,6)
      diferencia: 23940,
      situacion: "Retiró $ 239 de más",
    });
    expect(d.socios[1]).toMatchObject({ sigla: "SK", retiros: 100100, aportes: 40000, totalNeto: 60100, leCorresponde: 84040, diferencia: -23940, situacion: "Le falta retirar $ 239" });
    expect(d.total).toMatchObject({ sigla: "Total", retiros: 200100, gastosTesoreria: 20000, gastosCompras: 30000, aportes: 40000, totalNeto: 210100, leCorresponde: 210100 });
  });

  it("total retirado neto por mes (Tesorería por Fecha + Compras por Mes devengado), y el mes inicial corre las columnas", () => {
    if (!d.ok) throw new Error("faltan tipos");
    expect(d.porMes).toEqual([
      { id: ID.s1, sigla: "LR", valores: at([[MAY, 130000]]), total: 130000 },
      { id: ID.s2, sigla: "SK", valores: at([[JUN, 60100]]), total: 60100 },
    ]);
    const d2 = calcularSocios(periodoDesde("2026-05"), socios, tesoreriaCtx.tipos, comprobantes, movimientos);
    if (!d2.ok) throw new Error("faltan tipos");
    expect(d2.porMes[0].valores).toEqual(at([[0, 130000]]));
  });

  it("situación en el umbral de ± $ 1", () => {
    expect(situacion(0)).toBe("Parejo");
    expect(situacion(99)).toBe("Parejo");
    expect(situacion(-99)).toBe("Parejo");
    expect(situacion(100)).toBe("Retiró $ 1 de más");
    expect(situacion(-100)).toBe("Le falta retirar $ 1");
    expect(situacion(123456)).toBe("Retiró $ 1.235 de más");
    expect(situacion(-123449)).toBe("Le falta retirar $ 1.234");
  });

  it("falta un tipo de operación de socio → error con el nombre, no ceros", () => {
    const sinAporte = tesoreriaCtx.tipos.filter((t) => t.nombre !== "Aporte de socio");
    expect(calcularSocios(P, socios, sinAporte, comprobantes, movimientos)).toEqual({ ok: false, periodo: P, aviso: null, faltan: ["Aporte de socio"] });
    const ninguno = calcularSocios(P, socios, [], comprobantes, movimientos);
    expect(ninguno.ok ? [] : ninguno.faltan).toEqual(["Retiro de socio", "Gasto particular de socio", "Aporte de socio"]);
  });
});

describe("Saldos", () => {
  const d = calcularSaldos("2026-11-14", refsSaldos, comprobantes, movimientos);

  it("cuentas en su moneda: transferencias incluidas; saldo = inicial + entradas − salidas", () => {
    expect(d.cuentas).toEqual([
      { id: ID.ars, nombre: "Banco $", moneda: "ARS", saldoInicial: 100000, entradas: 102000, salidas: 365175, saldoActual: -163175 },
      { id: ID.usd, nombre: "Banco U$S", moneda: "USD", saldoInicial: 5000, entradas: 10001, salidas: 0, saldoActual: 15001 },
      { id: ID.ars2, nombre: "Caja $", moneda: "ARS", saldoInicial: 0, entradas: 32500, salidas: 0, saldoActual: 32500 },
    ]);
  });

  it("clientes: Activos + Inactivos con movimiento; facturado por cliente efectivo; ventas sin cliente", () => {
    expect(d.clientes).toEqual([
      { id: ID.cli2, nombre: "QA Cliente Dos", sigla: "QD", facturado: 0, cobrado: 0, saldo: 0 },
      { id: ID.cli4, nombre: "QA Cliente Inactivo con cobro", sigla: "QC", facturado: 0, cobrado: 2500, saldo: -2500 },
      { id: ID.cli1, nombre: "QA Cliente Uno", sigla: "QU", facturado: 90450, cobrado: 50000, saldo: 40450 },
    ]);
    expect(d.ventasSinCliente).toBe(10006001);
  });

  it("proveedores con movimiento, por nombre", () => {
    expect(d.proveedores).toEqual([
      { id: ID.prov2, nombre: "QA Proveedor Dos", facturado: 70000, pagado: 0, saldo: 70000 },
      { id: ID.prov1, nombre: "QA Proveedor Uno", facturado: 151000, pagado: 100000, saldo: 51000 },
    ]);
    expect(d.errorClientes).toBeNull();
    expect(d.errorProveedores).toBeNull();
  });

  it("sin el tipo «Cobro a cliente»: no hay tabla de Clientes (error con el nombre); Cuentas y Proveedores siguen", () => {
    const d2 = calcularSaldos("2026-11-14", { ...refsSaldos, tipos: refsSaldos.tipos.filter((t) => t.id !== ID.cobro) }, comprobantes, movimientos);
    expect(d2).toMatchObject({ clientes: null, ventasSinCliente: null, errorProveedores: null });
    expect(d2.errorClientes).toBe("No encontramos el tipo de operación «Cobro a cliente» en Maestros. Sin ese tipo no se pueden calcular los saldos de clientes.");
    expect(d2.cuentas).toEqual(d.cuentas);
    expect(d2.proveedores).toEqual(d.proveedores);
  });

  it("sin el tipo «Pago a proveedor»: no hay tabla de Proveedores (error con el nombre)", () => {
    const d3 = calcularSaldos("2026-11-14", { ...refsSaldos, tipos: refsSaldos.tipos.filter((t) => t.id !== ID.pago) }, comprobantes, movimientos);
    expect(d3).toMatchObject({ proveedores: null, errorClientes: null, ventasSinCliente: 10006001 });
    expect(d3.errorProveedores).toBe("No encontramos el tipo de operación «Pago a proveedor» en Maestros. Sin ese tipo no se pueden calcular los saldos de proveedores.");
    expect(d3.cuentas).toEqual(d.cuentas);
  });
});
