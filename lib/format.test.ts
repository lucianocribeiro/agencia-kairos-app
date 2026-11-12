import { describe, expect, it } from "vitest";

import {
  displayDateToIso,
  displayToPercent,
  formatCurrency,
  formatDateTime,
  formatNumber,
  hhmmToSeconds,
  isoToDisplayDate,
  parseNumber,
  percentToDisplay,
  secondsToDecimalHours,
  secondsToHHmm,
} from "./format";

const nbsp = (s: string) => s.replace(/ | /g, " ");

describe("fechas", () => {
  it("ISO → DD/MM/AAAA", () => {
    expect(isoToDisplayDate("2026-11-12")).toBe("12/11/2026");
    expect(isoToDisplayDate("2024-02-29")).toBe("29/02/2024");
  });

  it("dateTime ISO → fecha en hora de Buenos Aires", () => {
    // 02:00 UTC del 13 = 23:00 del 12 en Buenos Aires (UTC-3)
    expect(isoToDisplayDate("2026-11-13T02:00:00.000Z")).toBe("12/11/2026");
    expect(formatDateTime("2026-11-13T02:00:00.000Z")).toBe("12/11/2026 23:00");
  });

  it("inválidos o vacíos → cadena vacía", () => {
    expect(isoToDisplayDate("")).toBe("");
    expect(isoToDisplayDate(null)).toBe("");
    expect(isoToDisplayDate("2023-02-29")).toBe("");
    expect(isoToDisplayDate("cualquier cosa")).toBe("");
  });

  it("DD/MM/AAAA → ISO", () => {
    expect(displayDateToIso("12/11/2026")).toBe("2026-11-12");
    expect(displayDateToIso("1/2/2026")).toBe("2026-02-01");
    expect(displayDateToIso(" 29/02/2024 ")).toBe("2024-02-29");
  });

  it("DD/MM/AAAA inválido → null", () => {
    expect(displayDateToIso("29/02/2023")).toBeNull();
    expect(displayDateToIso("31/04/2026")).toBeNull();
    expect(displayDateToIso("12-11-2026")).toBeNull();
    expect(displayDateToIso("2026-11-12")).toBeNull();
    expect(displayDateToIso("")).toBeNull();
  });

  it("ida y vuelta", () => {
    expect(displayDateToIso(isoToDisplayDate("2026-01-05"))).toBe("2026-01-05");
  });
});

describe("números es-AR", () => {
  it("formatea con . de miles y , decimal", () => {
    expect(formatNumber(1234.5)).toBe("1.234,5");
    expect(formatNumber(1234567.891, { decimals: 2 })).toBe("1.234.567,89");
    expect(formatNumber(1000)).toBe("1.000");
    expect(formatNumber(0.5, { decimals: 2 })).toBe("0,50");
    expect(formatNumber(-42)).toBe("-42");
  });

  it("vacíos → cadena vacía", () => {
    expect(formatNumber(null)).toBe("");
    expect(formatNumber(Number.NaN)).toBe("");
  });

  it("moneda", () => {
    expect(nbsp(formatCurrency(1234.5, "ARS"))).toBe("$ 1.234,50");
    expect(nbsp(formatCurrency(1234.5, "USD"))).toBe("US$ 1.234,50");
  });

  it("parsea texto es-AR", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("1234,5")).toBe(1234.5);
    expect(parseNumber("-10")).toBe(-10);
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber("12.34")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});

describe("duraciones", () => {
  it("segundos → HH:mm", () => {
    expect(secondsToHHmm(0)).toBe("00:00");
    expect(secondsToHHmm(34200)).toBe("09:30");
    expect(secondsToHHmm(86340)).toBe("23:59");
    expect(secondsToHHmm(98100)).toBe("27:15");
    expect(secondsToHHmm(59)).toBe("00:00");
    expect(secondsToHHmm(-1800)).toBe("-00:30");
    expect(secondsToHHmm(null)).toBe("");
  });

  it("HH:mm → segundos", () => {
    expect(hhmmToSeconds("09:30")).toBe(34200);
    expect(hhmmToSeconds("9:30")).toBe(34200);
    expect(hhmmToSeconds("00:00")).toBe(0);
    expect(hhmmToSeconds("27:15")).toBe(98100);
    expect(hhmmToSeconds("09:60")).toBeNull();
    expect(hhmmToSeconds("0930")).toBeNull();
    expect(hhmmToSeconds("")).toBeNull();
  });

  it("horas decimales redondeadas a 2", () => {
    expect(secondsToDecimalHours(5400)).toBe(1.5);
    expect(secondsToDecimalHours(3600)).toBe(1);
    expect(secondsToDecimalHours(1200)).toBe(0.33);
    expect(secondsToDecimalHours(2400)).toBe(0.67);
    expect(secondsToDecimalHours(0)).toBe(0);
    expect(secondsToDecimalHours(null)).toBe(0);
  });
});

describe("porcentajes", () => {
  it("decimal → texto", () => {
    expect(nbsp(percentToDisplay(0.5))).toBe("50%");
    expect(nbsp(percentToDisplay(0.125))).toBe("12,5%");
    expect(nbsp(percentToDisplay(1))).toBe("100%");
    expect(percentToDisplay(null)).toBe("");
  });

  it("texto → decimal", () => {
    expect(displayToPercent("50")).toBe(0.5);
    expect(displayToPercent("50%")).toBe(0.5);
    expect(displayToPercent("12,5 %")).toBe(0.125);
    expect(displayToPercent("33,33")).toBe(0.3333);
    expect(displayToPercent("abc")).toBeNull();
  });

  it("ida y vuelta", () => {
    expect(displayToPercent(percentToDisplay(0.375))).toBe(0.375);
  });
});
