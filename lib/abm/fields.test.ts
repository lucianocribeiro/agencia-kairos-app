import { describe, expect, it } from "vitest";

import { formatForDisplay, formatForInput, parseField, parseValues, type FieldSpec } from "./fields";

const num: FieldSpec = { key: "n", label: "N", kind: "number" };
const pct: FieldSpec = { key: "p", label: "P", kind: "percent", min: 0, max: 100 };
const date: FieldSpec = { key: "d", label: "D", kind: "date" };
const cuit: FieldSpec = { key: "c", label: "C", kind: "cuit" };
const link: FieldSpec = { key: "l", label: "L", kind: "link" };

describe("ida y vuelta guardado → input → guardado", () => {
  it.each([
    [num, 1234.56],
    [num, -0.5],
    [num, 1000000],
    [pct, 0.5],
    [pct, 0.3333],
    [date, "2026-03-01"],
    [cuit, "20123456786"],
  ] as const)("%o %s", (spec, stored) => {
    expect(parseField(spec, formatForInput(spec, stored))).toEqual({ value: stored });
  });
});

describe("parseo", () => {
  it("links: array de IDs, single = máx. 1", () => {
    expect(parseField(link, ["recAAAAAAAAAAAAAA"])).toEqual({ value: ["recAAAAAAAAAAAAAA"] });
    expect(parseField(link, ["recAAAAAAAAAAAAAA", "recBBBBBBBBBBBBBB"])).toEqual({ error: "Elegí una sola opción." });
    expect(parseField(link, ["no-es-id"])).toEqual({ error: "Elegí una opción válida." });
    expect(parseField(link, [])).toEqual({ value: [] });
  });

  it("ignora claves que no son campos editables (readonly y desconocidas)", () => {
    const specs: FieldSpec[] = [
      { key: "codigo", label: "Código", kind: "readonly" },
      { key: "nombre", label: "Nombre", kind: "text", required: true },
    ];
    expect(parseValues(specs, { codigo: "X", nombre: " Hola ", otra: "y" }, "create")).toEqual({ values: { nombre: "Hola" }, errors: {} });
  });

  it("display es-AR", () => {
    expect(formatForDisplay(num, 1234.5)).toBe("1.234,5");
    expect(formatForDisplay(pct, 0.5)).toBe("50 %");
    expect(formatForDisplay(date, "2026-03-01")).toBe("01/03/2026");
    expect(formatForDisplay(cuit, "20123456786")).toBe("20-12345678-6");
    expect(formatForDisplay({ key: "b", label: "B", kind: "checkbox" }, true)).toBe("Sí");
    expect(formatForDisplay(link, ["recA"], { recA: "Acme" })).toBe("Acme");
  });
});

describe("número rechazado: pista de coma decimal", () => {
  const NUMBER = "Ingresá un número (por ejemplo 1.234,56).";
  const HINT = `${NUMBER} Para decimales usá coma (ej.: 12,5).`;
  it.each(["5.5", "12.5", "0.75", "950.5", "33.33", "1.23", "1.2345"])("%s → mensaje + pista (number y percent)", (t) => {
    expect(parseField(num, t)).toEqual({ error: HINT });
    expect(parseField(pct, `${t}%`)).toEqual({ error: HINT });
  });
  it.each(["12.34.567", "1,234.56", "abc"])("%s → mensaje de siempre, sin pista", (t) => {
    expect(parseField(num, t)).toEqual({ error: NUMBER });
  });
  it("vacío no es error de número; lo válido parsea igual", () => {
    expect(parseField(num, "")).toEqual({ value: null });
    expect(parseField(num, "12,5")).toEqual({ value: 12.5 });
    expect(parseField(num, "5.000")).toEqual({ value: 5000 });
  });
});
