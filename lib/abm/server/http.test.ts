import { describe, expect, it } from "vitest";

import { toRawValues } from "./http";

describe("toRawValues (allowlist explícita)", () => {
  const body = JSON.parse(
    '{"nombre":"Ana","activo":true,"proyectos":["recA",3],"monto":12.5,"desconocida":"x","otraClaveCamel":"y","__proto__":{"polluted":"HACK"},"constructor":"HACK","toString":"HACK","fld6Opt1EZhun7vKN":"HACK","objeto":{"a":1}}',
  ) as Record<string, unknown>;

  it("solo pasan las claves del spec (y con tipos de formulario)", () => {
    const raw = toRawValues(body, ["nombre", "activo", "proyectos", "monto", "objeto"]);
    expect({ ...raw }).toEqual({ nombre: "Ana", activo: true, proyectos: ["recA"], monto: "12.5" });
  });

  it("descarta una clave desconocida, una camelCase válida que no está en el spec, IDs de campo y __proto__/constructor", () => {
    const raw = toRawValues(body, ["nombre"]);
    expect(Object.keys(raw)).toEqual(["nombre"]);
    for (const k of ["desconocida", "otraClaveCamel", "fld6Opt1EZhun7vKN", "__proto__", "constructor", "toString"]) {
      expect(Object.prototype.hasOwnProperty.call(raw, k), k).toBe(false);
    }
  });

  it("aunque el spec pidiera __proto__ o constructor, no hay contaminación de prototipos", () => {
    const raw = toRawValues(body, ["__proto__", "constructor"]);
    expect(Object.getPrototypeOf(raw)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((raw as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("sin claves permitidas → objeto vacío sin prototipo", () => {
    const raw = toRawValues(body, []);
    expect(Object.keys(raw)).toEqual([]);
    expect(Object.getPrototypeOf(raw)).toBeNull();
  });
});
