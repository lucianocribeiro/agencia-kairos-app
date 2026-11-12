import { describe, expect, it } from "vitest";

import { addDays, buildBuckets, displayDate, displayMonth, isIsoDate, isoWeekMonday, mesAFacturarToStorage, shortcutRange, todayInBuenosAires } from "./dates";

describe("todayInBuenosAires", () => {
  it("usa la fecha de Buenos Aires (UTC−3), no la de UTC", () => {
    expect(todayInBuenosAires(new Date("2026-11-13T02:59:00Z"))).toBe("2026-11-12");
    expect(todayInBuenosAires(new Date("2026-11-13T03:00:00Z"))).toBe("2026-11-13");
    expect(todayInBuenosAires(new Date("2026-01-01T02:00:00Z"))).toBe("2025-12-31");
  });
});

describe("fechas YYYY-MM-DD", () => {
  it("valida fechas reales", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-29", "2026-13-01", "2026-1-01", "12/11/2026", "", null, 20261112]) expect(isIsoDate(bad)).toBe(false);
  });

  it("addDays cruza meses y años; formato de pantalla", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(displayDate("2026-11-05")).toBe("05/11/2026");
    expect(displayMonth("2026-11-01")).toBe("11/2026");
  });
});

describe("atajos de período", () => {
  const today = "2026-11-12";
  it("mes actual, mes anterior, trimestre calendario y año", () => {
    expect(shortcutRange("mesActual", today)).toEqual({ desde: "2026-11-01", hasta: "2026-11-30" });
    expect(shortcutRange("mesAnterior", today)).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(shortcutRange("trimestreActual", today)).toEqual({ desde: "2026-10-01", hasta: "2026-12-31" });
    expect(shortcutRange("anioActual", today)).toEqual({ desde: "2026-01-01", hasta: "2026-12-31" });
  });
  it("bordes: enero (mes anterior = diciembre del año anterior), febrero bisiesto, trimestres", () => {
    expect(shortcutRange("mesAnterior", "2026-01-15")).toEqual({ desde: "2025-12-01", hasta: "2025-12-31" });
    expect(shortcutRange("mesActual", "2028-02-10")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(shortcutRange("trimestreActual", "2026-03-31")).toEqual({ desde: "2026-01-01", hasta: "2026-03-31" });
    expect(shortcutRange("trimestreActual", "2026-04-01")).toEqual({ desde: "2026-04-01", hasta: "2026-06-30" });
  });
});

describe("buckets del dashboard", () => {
  it("diaria: un bucket por día, etiqueta DD/MM", () => {
    const b = buildBuckets({ desde: "2026-02-27", hasta: "2026-03-02" }, "diaria");
    expect(b.map((x) => x.key)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(b[0].label).toBe("27/02");
  });

  it("semanal: semanas ISO desde el lunes, cruzando el cambio de año, bordes parciales", () => {
    expect(isoWeekMonday("2026-01-01")).toBe("2025-12-29"); // jueves → lunes de la semana ISO 1 de 2026
    expect(isoWeekMonday("2026-11-15")).toBe("2026-11-09"); // domingo
    expect(isoWeekMonday("2026-11-09")).toBe("2026-11-09");
    const b = buildBuckets({ desde: "2025-12-31", hasta: "2026-01-14" }, "semanal");
    expect(b).toEqual([
      { key: "2025-12-29", label: "Sem 29/12", desde: "2025-12-31", hasta: "2026-01-04" },
      { key: "2026-01-05", label: "Sem 05/01", desde: "2026-01-05", hasta: "2026-01-11" },
      { key: "2026-01-12", label: "Sem 12/01", desde: "2026-01-12", hasta: "2026-01-14" },
    ]);
  });

  it("mensual: meses MM/AAAA con bordes parciales", () => {
    expect(buildBuckets({ desde: "2026-10-15", hasta: "2027-01-10" }, "mensual")).toEqual([
      { key: "2026-10", label: "10/2026", desde: "2026-10-15", hasta: "2026-10-31" },
      { key: "2026-11", label: "11/2026", desde: "2026-11-01", hasta: "2026-11-30" },
      { key: "2026-12", label: "12/2026", desde: "2026-12-01", hasta: "2026-12-31" },
      { key: "2027-01", label: "01/2027", desde: "2027-01-01", hasta: "2027-01-10" },
    ]);
  });

  it("cubren todo el rango sin huecos ni solapes", () => {
    for (const grouping of ["diaria", "semanal", "mensual"] as const) {
      const b = buildBuckets({ desde: "2026-01-01", hasta: "2026-12-31" }, grouping);
      expect(b[0].desde).toBe("2026-01-01");
      expect(b.at(-1)!.hasta).toBe("2026-12-31");
      for (let i = 1; i < b.length; i++) expect(b[i].desde).toBe(addDays(b[i - 1].hasta, 1));
    }
  });
});

describe("Mes a facturar", () => {
  it("se guarda como YYYY-MM-01", () => {
    expect(mesAFacturarToStorage("2026-11")).toBe("2026-11-01");
    expect(mesAFacturarToStorage("2026-11-01")).toBe("2026-11-01");
    for (const bad of ["2026-13", "2026-11-15", "11/2026", "", null, 202611]) expect(mesAFacturarToStorage(bad)).toBeNull();
  });
});
