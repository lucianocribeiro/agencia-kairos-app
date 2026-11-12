import { describe, expect, it } from "vitest";

import { formatHours, formatTime, parseTime, recordHours, sumHours } from "./time";

/**
 * Referencia exacta de la fórmula de Airtable fldTSWNksJnEbYTLW:
 *   IF(AND({desde}, {hasta}), ROUND(({hasta} - {desde}) / 3600, 2))
 * ROUND(x, 2) con aritmética entera (mitad hacia arriba): floor((s·100 + 1800) / 3600) / 100.
 */
function airtableFormula(desde: number, hasta: number): number | null {
  if (!desde || !hasta) return null; // AND() con 0 es falso
  const s = hasta - desde;
  const sign = s < 0 ? -1 : 1;
  return (sign * Math.floor((Math.abs(s) * 100 + 1800) / 3600)) / 100;
}

describe("parseTime / formatTime", () => {
  it("HH:mm de 00:00 a 23:59 ↔ segundos múltiplos de 60", () => {
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("09:30")).toBe(34_200);
    expect(parseTime("9:05")).toBe(32_700);
    expect(parseTime(" 23:59 ")).toBe(86_340);
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(86_340)).toBe("23:59");
    expect(formatTime(34_259)).toBe("09:30"); // se trunca al minuto
  });

  it("rechaza lo que está fuera de rango o mal formado", () => {
    for (const bad of ["24:00", "23:60", "-1:00", "12", "12:5", "12:345", "1230", "ab:cd", "", " ", "12:30:00"]) {
      expect(parseTime(bad), bad).toBeNull();
    }
    for (const bad of [null, undefined, 34200, ["09:00"]]) expect(parseTime(bad)).toBeNull();
    expect(formatTime(-60)).toBe("");
    expect(formatTime(86_400)).toBe("");
    expect(formatTime(null)).toBe("");
  });
});

describe("recordHours = fórmula de Airtable", () => {
  it("coincide en todos los rangos de minutos posibles desde las 00:01", () => {
    for (let desdeMin = 1; desdeMin < 1440; desdeMin += 7) {
      for (let hastaMin = desdeMin + 1; hastaMin < 1440; hastaMin++) {
        const d = desdeMin * 60;
        const h = hastaMin * 60;
        expect(recordHours(d, h)).toBe(airtableFormula(d, h));
      }
    }
  });

  it("valores de borde: 1 minuto, 1/3 y 2/3 de hora, día casi completo y empates con segundos", () => {
    expect(recordHours(3600, 3660)).toBe(0.02); // 0,01666…
    expect(recordHours(3600, 4800)).toBe(0.33); // 20 min
    expect(recordHours(3600, 6000)).toBe(0.67); // 40 min
    expect(recordHours(60, 86_340)).toBe(23.97);
    expect(recordHours(32_400, 37_800)).toBe(1.5);
    // Datos viejos con segundos: 18 s = 0,005 h → empate, hacia arriba como ROUND.
    for (const s of [18, 54, 90, 1818, 3618, 35_982]) expect(recordHours(3600, 3600 + s)).toBe(airtableFormula(3600, 3600 + s));
  });

  it("falta una hora o el rango no es positivo → 0", () => {
    expect(recordHours(null, 3600)).toBe(0);
    expect(recordHours(3600, undefined)).toBe(0);
    expect(recordHours(7200, 3600)).toBe(0);
    expect(recordHours(3600, 3600)).toBe(0);
  });

  it("diferencia conocida: desde 00:00 cuenta acá, en la fórmula de Airtable queda en blanco", () => {
    expect(recordHours(0, 5400)).toBe(1.5);
    expect(airtableFormula(0, 5400)).toBeNull();
  });
});

describe("sumHours / formatHours", () => {
  it("suma en centésimas, sin error de punto flotante", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumHours([0.1, 0.2])).toBe(0.3);
    expect(sumHours(Array.from({ length: 1000 }, () => 0.33))).toBe(330);
    expect(sumHours([])).toBe(0);
  });

  it("2 decimales es-AR", () => {
    expect(formatHours(1.5)).toBe("1,50");
    expect(formatHours(1234.5)).toBe("1.234,50");
    expect(formatHours(0)).toBe("0,00");
  });
});
