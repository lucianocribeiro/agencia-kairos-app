import { describe, expect, it } from "vitest";

import { addCalendarYears, RANGE_MESSAGES, resolveRange } from "./write";

const TODAY = "2026-11-12";

describe("resolveRange · límite de 10 años calendario (F1-04-02)", () => {
  it("exactamente 10 años → OK; 10 años + 1 día → 400", () => {
    expect(resolveRange("2016-11-12", "2026-11-12", TODAY)).toEqual({ range: { desde: "2016-11-12", hasta: "2026-11-12" } });
    expect(resolveRange("2016-11-12", "2026-11-13", TODAY)).toEqual({ error: RANGE_MESSAGES.largo });
    expect(resolveRange("2016-01-01", "2025-12-31", TODAY)).toMatchObject({ range: { desde: "2016-01-01" } });
    expect(resolveRange("2016-01-01", "2026-01-01", TODAY)).toMatchObject({ range: { hasta: "2026-01-01" } });
    expect(resolveRange("2016-01-01", "2026-01-02", TODAY)).toEqual({ error: RANGE_MESSAGES.largo });
  });

  it("29/02: 10 años después cae en 28/02 (año destino no bisiesto)", () => {
    expect(addCalendarYears("2016-02-29", 10)).toBe("2026-02-28");
    expect(resolveRange("2016-02-29", "2026-02-28", TODAY)).toMatchObject({ range: { hasta: "2026-02-28" } });
    expect(resolveRange("2016-02-29", "2026-03-01", TODAY)).toEqual({ error: RANGE_MESSAGES.largo });
    // Destino bisiesto: se mantiene el 29/02.
    expect(addCalendarYears("2020-02-29", 8)).toBe("2028-02-29");
    expect(addCalendarYears("2096-02-29", 4)).toBe("2100-02-28"); // 2100 no es bisiesto
    expect(addCalendarYears("2995-07-15", 10)).toBe("3005-07-15"); // no depende del tope de años de isIsoDate
    expect(resolveRange("2018-02-28", "2028-02-28", TODAY)).toMatchObject({ range: { hasta: "2028-02-28" } });
    expect(resolveRange("2018-02-28", "2028-02-29", TODAY)).toEqual({ error: RANGE_MESSAGES.largo });
  });

  it("el resto de las reglas sigue igual", () => {
    expect(resolveRange(null, null, TODAY)).toEqual({ range: { desde: "2026-11-01", hasta: "2026-11-30" } });
    expect(resolveRange("2026-11-30", "2026-11-01", TODAY)).toEqual({ error: RANGE_MESSAGES.orden });
    expect(resolveRange("2026-11-01", null, TODAY)).toEqual({ error: RANGE_MESSAGES.fecha });
  });
});
