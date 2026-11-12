import { describe, expect, it } from "vitest";

import { canReadField, readableFields, redactFields } from "./access";
import { COMPUTED_FIELDS, FIELD_TABLE, READ_ONLY_FIELDS, REFERENCE_FIELDS, RESTRICTED_FIELDS, TABLES } from "./schema";

const H = TABLES.horas.fields;
const U = TABLES.usuarios.fields;
const P = TABLES.proyectos.fields;

describe("schema", () => {
  it("todos los IDs tienen formato válido", () => {
    for (const table of Object.values(TABLES)) {
      expect(table.id).toMatch(/^tbl[A-Za-z0-9]{14}$/);
      for (const id of Object.values(table.fields)) expect(id).toMatch(/^fld[A-Za-z0-9]{14}$/);
    }
  });

  it("no hay IDs repetidos", () => {
    const tableIds = Object.values(TABLES).map((t) => t.id);
    const fieldIds = Object.values(TABLES).flatMap((t) => Object.values(t.fields));
    expect(new Set(tableIds).size).toBe(tableIds.length);
    expect(new Set(fieldIds).size).toBe(fieldIds.length);
    expect(FIELD_TABLE.size).toBe(fieldIds.length);
  });

  it("incluye las 13 tablas", () => {
    expect(Object.keys(TABLES)).toHaveLength(13);
  });

  it("campos calculados de Horas", () => {
    expect([...COMPUTED_FIELDS].sort()).toEqual(
      [H.numero, H.horas, H.valorHora, H.moneda, H.cliente, H.importeAFacturar, H.mesTrabajado, H.mesAFacturarAAAAMM, H.creado].sort(),
    );
  });

  it("links inversos de solo lectura = todas las referencias", () => {
    for (const id of [U.horasReverse, U.horas2Reverse, P.usuarios, TABLES.clientes.fields.proyectos, TABLES.categorias.fields.proveedores]) {
      expect(READ_ONLY_FIELDS.has(id)).toBe(true);
    }
    expect(READ_ONLY_FIELDS.size).toBe(Object.values(REFERENCE_FIELDS).flat().length);
    // los links que sí se escriben no son de solo lectura
    for (const id of [P.cliente, TABLES.usuarios.fields.proyectosAsignados, TABLES.proveedores.fields.categoriaPorDefecto]) {
      expect(READ_ONLY_FIELDS.has(id)).toBe(false);
    }
  });

  it("cada referencia pertenece a su tabla", () => {
    for (const [key, ids] of Object.entries(REFERENCE_FIELDS)) {
      for (const id of ids) expect(FIELD_TABLE.get(id)).toBe(TABLES[key as keyof typeof TABLES].id);
    }
  });

  it("campos restringidos", () => {
    for (const id of [U.passwordHash, H.valorHora, H.moneda, H.importeAFacturar, H.cliente, P.valorHora, P.monedaValorHora]) {
      expect(RESTRICTED_FIELDS.has(id)).toBe(true);
    }
  });
});

describe("access", () => {
  it("passwordHash nunca se devuelve, ni a Admin", () => {
    expect(canReadField(U.passwordHash, "Admin")).toBe(false);
    expect(canReadField(U.passwordHash, "Empleado")).toBe(false);
  });

  it("Empleado no ve valores ni importes; Admin sí", () => {
    expect(canReadField(H.importeAFacturar, "Empleado")).toBe(false);
    expect(canReadField(H.importeAFacturar, "Admin")).toBe(true);
    expect(readableFields([H.fecha, H.tarea, H.valorHora, P.monedaValorHora], "Empleado")).toEqual([H.fecha, H.tarea]);
  });

  it("redactFields saca campos no permitidos", () => {
    expect(redactFields({ [H.tarea]: "x", [H.moneda]: "USD", [U.passwordHash]: "h" }, "Empleado")).toEqual({ [H.tarea]: "x" });
    expect(redactFields({ [H.moneda]: "USD", [U.passwordHash]: "h" }, "Admin")).toEqual({ [H.moneda]: "USD" });
  });
});
