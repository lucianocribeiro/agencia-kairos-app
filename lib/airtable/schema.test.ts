import { describe, expect, it } from "vitest";

import { canReadField, readableFields, redactFields } from "./access";
import { COMPUTED_FIELDS, FIELD_TABLE, INVERSE_ONLY_FIELDS, READ_ONLY_FIELDS, REFERENCE_FIELDS, RESTRICTED_FIELDS, TABLES } from "./schema";

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

  it("incluye las 17 tablas (Leads desde CC-F4-06)", () => {
    expect(Object.keys(TABLES)).toHaveLength(17);
    expect(TABLES.leads.id).toBe("tblZfsKxIckVSNRlV");
  });

  it("campos que llena Airtable (autoNumber y createdTime): solo N° de Horas y Tesorería y Creado de Horas", () => {
    expect([...COMPUTED_FIELDS].sort()).toEqual([H.numero, H.creado, TABLES.tesoreria.fields.numero].sort());
  });

  it("links inversos de solo lectura = todas las referencias", () => {
    for (const id of [U.horasReverse, U.horas2Reverse, P.usuarios, TABLES.clientes.fields.proyectos, TABLES.categorias.fields.proveedores]) {
      expect(READ_ONLY_FIELDS.has(id)).toBe(true);
    }
    expect(READ_ONLY_FIELDS.size).toBe(Object.values(REFERENCE_FIELDS).flat().length + INVERSE_ONLY_FIELDS.length);
    // los links que sí se escriben no son de solo lectura
    for (const id of [P.cliente, TABLES.usuarios.fields.proyectosAsignados, TABLES.proveedores.fields.categoriaPorDefecto]) {
      expect(READ_ONLY_FIELDS.has(id)).toBe(false);
    }
  });

  it("Clientes › Leads: link inverso de solo lectura que no bloquea el borrado de un cliente; Leads › Cliente sí se escribe", () => {
    expect([...INVERSE_ONLY_FIELDS]).toEqual([TABLES.clientes.fields.leads]);
    expect(READ_ONLY_FIELDS.has(TABLES.clientes.fields.leads)).toBe(true);
    expect((REFERENCE_FIELDS.clientes as readonly string[]).includes(TABLES.clientes.fields.leads)).toBe(false);
    expect(READ_ONLY_FIELDS.has(TABLES.leads.fields.cliente)).toBe(false);
    expect(REFERENCE_FIELDS.leads).toEqual([]);
  });

  it("cada referencia pertenece a su tabla", () => {
    for (const [key, ids] of Object.entries(REFERENCE_FIELDS)) {
      for (const id of ids) expect(FIELD_TABLE.get(id)).toBe(TABLES[key as keyof typeof TABLES].id);
    }
  });

  it("campos restringidos", () => {
    expect([...RESTRICTED_FIELDS].sort()).toEqual([U.passwordHash, P.valorHora, P.monedaValorHora, P.cliente, H.estadoFacturacion].sort());
  });
});

describe("access", () => {
  it("passwordHash nunca se devuelve, ni a Admin", () => {
    expect(canReadField(U.passwordHash, "Admin")).toBe(false);
    expect(canReadField(U.passwordHash, "Empleado")).toBe(false);
  });

  it("Empleado no ve valores ni importes; Admin sí", () => {
    expect(canReadField(P.valorHora, "Empleado")).toBe(false);
    expect(canReadField(P.valorHora, "Admin")).toBe(true);
    expect(readableFields([H.fecha, H.tarea, P.valorHora, P.monedaValorHora], "Empleado")).toEqual([H.fecha, H.tarea]);
  });

  it("Proyectos › cliente: Empleado no lo ve; Admin sí", () => {
    expect(canReadField(P.cliente, "Empleado")).toBe(false);
    expect(canReadField(P.cliente, "Admin")).toBe(true);
    expect(readableFields([P.codigo, P.estado, P.cliente], "Empleado")).toEqual([P.codigo, P.estado]);
    expect(redactFields({ [P.codigo]: "QZ - Uno", [P.cliente]: ["recCLIENTE0000000"] }, "Empleado")).toEqual({ [P.codigo]: "QZ - Uno" });
  });

  it("redactFields saca campos no permitidos", () => {
    expect(redactFields({ [H.tarea]: "x", [P.monedaValorHora]: "USD", [U.passwordHash]: "h" }, "Empleado")).toEqual({ [H.tarea]: "x" });
    expect(redactFields({ [P.monedaValorHora]: "USD", [U.passwordHash]: "h" }, "Admin")).toEqual({ [P.monedaValorHora]: "USD" });
  });
});
