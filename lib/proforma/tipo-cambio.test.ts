import { describe, expect, it } from "vitest";

import { calcularProforma, ivaDe, type TotalMoneda } from "./proforma";
import {
  aplicarTipoCambio,
  convertirAPesos,
  detalleEquivalente,
  equivalenteFilas,
  formatTipoCambio,
  leerTipoCambio,
  netoArsDesdeUsd,
  parseTipoCambio,
  TC_MAX_LARGO,
  TC_MESSAGES,
} from "./tipo-cambio";

/** Referencia exacta (BigInt): ROUND(subtotalUsd / 100 × TC, 2) en centavos, mitad lejos del cero. */
function referencia(subtotalUsd: number, tc: number): number {
  const tc4 = BigInt(Math.round(tc * 1e4));
  const num = BigInt(subtotalUsd) * tc4; // centavos × 10⁴
  const diezMil = BigInt(10_000);
  const q = num / diezMil;
  const r = num % diezMil;
  return Number(r * BigInt(2) >= diezMil ? q + BigInt(1) : q);
}

/** Dígitos significativos del producto exacto (centavos × TC): con ≤ 15, toCents coincide con la referencia. */
const digitosExactos = (subtotalUsd: number, tc: number) => (BigInt(subtotalUsd) * BigInt(Math.round(tc * 1e4))).toString().replace(/0+$/, "").length;

describe("parseTipoCambio (es-AR, > 0, ≤ 1.000.000, ≤ 4 decimales)", () => {
  it.each([
    ["1050,25", 1050.25],
    ["1.050,25", 1050.25],
    ["1050.25", 1050.25],
    ["  1.050,2575 ", 1050.2575],
    ["0,0001", 0.0001],
    ["1", 1],
    ["1.000.000", 1_000_000],
    ["1000000", 1_000_000],
    ["1234,5678", 1234.5678],
    ["1,23450", 1.2345],
    ["999.999,9999", 999999.9999],
  ])("%s → %s", (txt, n) => {
    expect(parseTipoCambio(txt)).toBe(n);
  });

  it.each(["0", "0,0000", "-1", "-0,5", "1.000.000,01", "1000001", "1,23456", "0,00001", "abc", "", " ", "1e3", "1,2,3", "1.05", "$ 1000"])("%s → inválido", (txt) => {
    // «1.05» es ambiguo y parseNumberInput lo rechaza (punto con < 4 enteros).
    expect(parseTipoCambio(txt)).toBeNull();
  });

  it("no texto → null; leerTipoCambio: ausente/null/vacío = sin TC, inválido = mensaje es-AR", () => {
    for (const v of [1050, null, undefined, true, {}, ["1"]]) expect(parseTipoCambio(v)).toBeNull();
    for (const v of [undefined, null, "", "   "]) expect(leerTipoCambio(v)).toEqual({ tc: null });
    for (const v of ["0", "x", 5, {}]) expect(leerTipoCambio(v)).toEqual({ error: TC_MESSAGES.invalido });
    expect(leerTipoCambio("1.050,25")).toEqual({ tc: 1050.25 });
    expect(TC_MESSAGES.invalido).toMatch(/^Ingresá un tipo de cambio válido/);
  });

  it("formatTipoCambio es-AR y se vuelve a leer igual (lo que viaja en ?tc= y en el body)", () => {
    for (const tc of [1, 0.0001, 1050.25, 1050.2575, 1234.5678, 999999.9999, 1_000_000, 12.5]) expect(parseTipoCambio(formatTipoCambio(tc))).toBe(tc);
    expect(formatTipoCambio(1050.25)).toBe("1.050,25");
    expect(formatTipoCambio(1234.5678)).toBe("1.234,5678");
    expect(formatTipoCambio(1000)).toBe("1.000");
  });
});

describe("parseTipoCambio por texto (CC-F5-22 · F5-09-01)", () => {
  // El valor devuelto es EXACTAMENTE el decimal escrito (sin redondeo silencioso).
  it.each([
    ["1,23450", 1.2345],
    ["1.050,25", 1050.25],
    ["1000000", 1000000],
    ["1000000,0000", 1000000],
    ["1.000.000,0000", 1000000],
    ["1050.2575", 1050.2575],
    [",5", 0.5],
    ["0,0001", 0.0001],
    ["999999,9999", 999999.9999],
    ["  1.050,25  ", 1050.25],
  ])("%s → %s (exacto)", (txt, n) => {
    expect(parseTipoCambio(txt)).toBe(n);
    expect(Object.is(parseTipoCambio(txt), n)).toBe(true);
  });

  it.each([
    "1000,12345",
    "1000,00001",
    "999999,99999",
    "1000000,0001",
    "-0",
    "0",
    "0,0000",
    "1e3",
    "1E3",
    "١٢٣",
    "１２３",
    "1 000",
    "+5",
    "-5",
    "1,",
    ",",
    ".5",
    "1.05",
    "1,000.5",
    "Infinity",
    "NaN",
    "0x10",
    "1_000",
  ])("%s → inválido", (txt) => {
    expect(parseTipoCambio(txt)).toBeNull();
  });

  it(`más de ${TC_MAX_LARGO} caracteres → inválido (aunque sea un número válido)`, () => {
    const de21 = `1,${"0".repeat(19)}`; // 21 caracteres; con ≤ 20 sería 1
    expect(de21).toHaveLength(21);
    expect(parseTipoCambio(de21)).toBeNull();
    expect(parseTipoCambio(de21.slice(0, 20))).toBe(1);
    expect(parseTipoCambio(" ".repeat(18) + "100")).toBeNull(); // el largo cuenta antes de sacar los bordes
  });

  it("el bug de la tolerancia: un quinto decimal no se redondea en silencio", () => {
    for (const t of ["1000,00001", "999999,99999", "123456,00004", "1,00001"]) expect(leerTipoCambio(t)).toEqual({ error: TC_MESSAGES.invalido });
  });
});

describe("conversión (redondeo)", () => {
  it("toCents(subtotalUsd / 100 × TC): mitad lejos del cero, con 4 decimales", () => {
    expect(netoArsDesdeUsd(1, 0.5)).toBe(1); // 0,005 → 0,01
    expect(netoArsDesdeUsd(3, 0.5)).toBe(2); // 0,015 → 0,02
    expect(netoArsDesdeUsd(1, 0.4999)).toBe(0); // 0,004999 → 0
    expect(netoArsDesdeUsd(100, 1050.2575)).toBe(105026); // 1050,2575 → 1050,26
    expect(netoArsDesdeUsd(100, 1050.2549)).toBe(105025);
    expect(netoArsDesdeUsd(6832, 1050.25)).toBe(7175308); // 68,32 × 1050,25 = 71.753,08
    expect(netoArsDesdeUsd(12345, 1234.5678)).toBe(15240739); // 123,45 × 1234,5678 = 152.407,394… → 152.407,39
    expect(netoArsDesdeUsd(0, 1050)).toBe(0);
  });

  it("valores grandes: USD 9.999.999,99 a TC 1.000.000 y a TC 999.999,9999 (centavos exactos, enteros seguros)", () => {
    expect(netoArsDesdeUsd(999_999_999, 1_000_000)).toBe(999_999_999_000_000);
    const r = netoArsDesdeUsd(999_999_999, 999_999.9999);
    expect(Number.isSafeInteger(r)).toBe(true);
    // 9.999.999,99 × 999.999,9999 = 9.999.999.989.000,0001 → 9.999.999.989.000,00 (toCents con 15 dígitos, como Excel)
    expect(r).toBe(999_999_998_900_000);
  });

  it("coincide con la referencia exacta en una grilla de importes y TC (producto ≤ 15 dígitos)", () => {
    const usds = [1, 7, 99, 100, 1234, 5000, 6832, 99_999, 123_456, 1_000_000, 12_345_678];
    const tcs = [0.0001, 0.5, 1, 1.0001, 12.3456, 350.75, 999.9999, 1050.25, 1050.2575, 1234.5678, 99_999.9999];
    let n = 0;
    for (const u of usds)
      for (const tc of tcs) {
        if (digitosExactos(u, tc) > 15) continue;
        expect([u, tc, netoArsDesdeUsd(u, tc)]).toEqual([u, tc, referencia(u, tc)]);
        n++;
      }
    expect(n).toBeGreaterThan(100);
  });

  it("mixta ARS + USD: neto = ARS + USD convertidos; IVA sobre el neto total; total = neto + IVA; nunca USD + ARS sin convertir", () => {
    const totales: TotalMoneda[] = [
      { moneda: "ARS", subtotal: 225927, iva: 47445, total: 273372 },
      { moneda: "USD", subtotal: 6832, iva: 1435, total: 8267 },
    ];
    const cv = convertirAPesos(totales, 1050.25, 0.21);
    expect(cv).toEqual({ tipoCambio: 1050.25, subtotalArs: 225927, subtotalUsd: 6832, netoArsDesdeUsd: 7175308, neto: 7401235, iva: 1554259, total: 8955494, mixta: true });
    expect(cv.iva).toBe(ivaDe(cv.neto, 0.21));
    // El IVA NO es la suma de los IVA por moneda (convertidos o no).
    expect(cv.neto).not.toBe(225927 + 6832);
    // Solo USD / solo ARS.
    expect(convertirAPesos([totales[1]], 1050.25, 0.21)).toMatchObject({ subtotalArs: 0, netoArsDesdeUsd: 7175308, neto: 7175308, mixta: false });
    expect(convertirAPesos([totales[0]], 1050.25, 0.21)).toMatchObject({ subtotalUsd: 0, netoArsDesdeUsd: 0, neto: 225927, iva: 47445, total: 273372, mixta: false });
  });

  it("filas del bloque «Equivalente en pesos»: mixta con las dos partes; solo USD sin la parte en ARS", () => {
    const totales: TotalMoneda[] = [
      { moneda: "ARS", subtotal: 225927, iva: 0, total: 0 },
      { moneda: "USD", subtotal: 6832, iva: 0, total: 0 },
    ];
    expect(equivalenteFilas(convertirAPesos(totales, 1050.25, 0.21), "IVA 21 %").map((f) => [f.label, f.cents])).toEqual([
      ["Parte en ARS (neto)", 225927],
      ["USD 68,32 a TC 1.050,25 (neto)", 7175308],
      ["Neto", 7401235],
      ["IVA 21 %", 1554259],
      ["Total", 8955494],
    ]);
    expect(equivalenteFilas(convertirAPesos([totales[1]], 1050.25, 0.21), "IVA 21 %").map((f) => f.label)).toEqual(["Neto", "IVA 21 %", "Total"]);
    expect(detalleEquivalente(6832, 1050.25)).toBe("Equivalente a USD 68,32 a TC 1.050,25");
    expect(detalleEquivalente(123456789, 1234.5678)).toBe("Equivalente a USD 1.234.567,89 a TC 1.234,5678");
  });
});

describe("aplicarTipoCambio (pantalla y PDF)", () => {
  const cliente = { id: "recCLIENTE1000000", nombre: "QA", sigla: "QA", cuit: null, condicionIva: null };
  const proforma = (monedas: ("ARS" | "USD")[]) =>
    calcularProforma({
      cliente,
      mes: "2026-10",
      alicuota: 0.21,
      proyectos: monedas.map((m, i) => ({ id: `recPROYECTO00000${i}`, codigo: `QA - ${m}`, cliente: cliente.id, valorHora: m === "USD" ? 37.33 : 1234.57, moneda: m })),
      horas: monedas.map((_, i) => ({ id: `recHORA000000000${i}`, fecha: "2026-10-05", colaborador: null, proyecto: `recPROYECTO00000${i}`, tarea: "x", desde: 32400, hasta: 37800, facturable: true, mesAFacturar: null })),
      colaboradores: new Map(),
    });

  it("sin USD o sin TC → la misma proforma, sin cambios", () => {
    const ars = proforma(["ARS"]);
    expect(aplicarTipoCambio(ars, 1050.25)).toBe(ars);
    expect("conversion" in aplicarTipoCambio(ars, 1050.25)).toBe(false);
    const usd = proforma(["ARS", "USD"]);
    expect(aplicarTipoCambio(usd, null)).toBe(usd);
  });

  it("con USD y TC → conversion; los totales por moneda quedan iguales", () => {
    const d = proforma(["ARS", "USD"]);
    const c = aplicarTipoCambio(d, 1050.25);
    expect(c.totales).toEqual(d.totales);
    expect(c.conversion).toEqual(convertirAPesos(d.totales, 1050.25, 0.21));
    expect(c.conversion!.subtotalUsd).toBe(5600); // 1,5 h × 37,33 = 55,995 → 56,00
  });
});
