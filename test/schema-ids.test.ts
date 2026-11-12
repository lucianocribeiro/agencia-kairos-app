import { describe, expect, it } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { diffTable, schemaTable } from "../scripts/lib/schema-ids.mjs";

const NAMES = { email: "Email", ip: "IP", resultado: "Resultado", fecha: "Fecha" };
const F = TABLES.intentosLogin.fields;
const real = (over: Partial<Record<string, string>> = {}) => ({
  id: over.table ?? TABLES.intentosLogin.id,
  fields: [
    { id: over.email ?? F.email, name: "Email" },
    { id: over.ip ?? F.ip, name: "IP" },
    { id: F.resultado, name: "Resultado" },
    { id: F.fecha, name: "Fecha" },
  ],
});

describe("scripts/lib/schema-ids.mjs (F-04)", () => {
  it("lee los IDs de lib/airtable/schema.ts", () => {
    expect(schemaTable("intentosLogin")).toEqual({ id: TABLES.intentosLogin.id, fields: { ...F } });
    expect(schemaTable("usuarios")).toEqual({ id: TABLES.usuarios.id, fields: { ...TABLES.usuarios.fields } });
  });

  it("coincide → sin diferencias", () => {
    expect(diffTable(real(), schemaTable("intentosLogin"), NAMES)).toEqual([]);
  });

  it("ID de tabla o de campo distinto → lo reporta con el ID real", () => {
    const problems = diffTable(real({ table: "tblXXXXXXXXXXXXXX", ip: "fldYYYYYYYYYYYYYY" }), schemaTable("intentosLogin"), NAMES);
    expect(problems).toEqual([
      `tabla: real tblXXXXXXXXXXXXXX ≠ schema.ts ${TABLES.intentosLogin.id}`,
      `ip ("IP"): real fldYYYYYYYYYYYYYY ≠ schema.ts ${F.ip}`,
    ]);
  });

  it("campo faltante → lo reporta", () => {
    const t = real();
    t.fields = t.fields.filter((f) => f.name !== "Fecha");
    expect(diffTable(t, schemaTable("intentosLogin"), NAMES)).toEqual(['fecha ("Fecha"): no existe en la base']);
  });
});
