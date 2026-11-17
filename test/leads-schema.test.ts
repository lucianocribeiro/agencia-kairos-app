import { describe, expect, it } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { diffTable, schemaTable } from "../scripts/lib/schema-ids.mjs";

/**
 * Leads (CC-F4-06): IDs de schema.ts = los que devolvió la Meta API al crear la tabla
 * (tabla, 15 campos en orden, opciones de los singleSelect y el link inverso en Clientes).
 */
const META_LEADS = {
  id: "tblZfsKxIckVSNRlV",
  primaryFieldId: "fldq8J1WaUiMl8fqI",
  fields: [
    { id: "fldq8J1WaUiMl8fqI", name: "Nombre", type: "singleLineText" },
    { id: "fld7viUkRfGwaX33E", name: "Tipo", type: "singleSelect", choices: ["Cliente", "Lead", "Ex Cliente", "Frío", "Partnership"] },
    { id: "fld5p3RK5G0JJxmqQ", name: "Status", type: "singleSelect", choices: ["Activo", "Concluido"] },
    { id: "fldFQ1KhgW7hsA3jn", name: "Proyecto", type: "multilineText" },
    { id: "fldMLW6VEoRzUU6wV", name: "Contacto", type: "singleLineText" },
    { id: "fldlYSdtbQtmK1HSh", name: "Teléfono", type: "phoneNumber" },
    { id: "fldTbo0itAwTsTtg4", name: "Mail", type: "email" },
    { id: "fldlyIddv6yB5T30F", name: "Origen", type: "singleSelect", choices: ["F&F", "Referidos", "Orgánico"] },
    { id: "fldeX0DEHzLbqvRZ3", name: "Referido por", type: "singleLineText" },
    { id: "fldfA6NoqDF0xFVnc", name: "Comentarios", type: "multilineText" },
    { id: "fldjpJHz4Tr8mKfkw", name: "Ventas", type: "singleLineText" },
    { id: "fldHdujd5mywXj8Ys", name: "Cobranzas", type: "singleLineText" },
    { id: "flddA1ngmH2SjYLEa", name: "Ventas SRL", type: "singleLineText" },
    { id: "fld1T55CjnHNX8AAd", name: "Cobranzas SRL", type: "singleLineText" },
    { id: "fldqfK9S27C6ZsqXa", name: "Cliente", type: "multipleRecordLinks", linkedTableId: "tblsf0Wa09QVk3vvR", inverseLinkFieldId: "fldVOksrSGDYTcIaw" },
  ],
};
const NAMES = {
  nombre: "Nombre",
  tipo: "Tipo",
  status: "Status",
  proyecto: "Proyecto",
  contacto: "Contacto",
  telefono: "Teléfono",
  mail: "Mail",
  origen: "Origen",
  referidoPor: "Referido por",
  comentarios: "Comentarios",
  ventas: "Ventas",
  cobranzas: "Cobranzas",
  ventasSrl: "Ventas SRL",
  cobranzasSrl: "Cobranzas SRL",
  cliente: "Cliente",
};

describe("schema · Leads (CC-F4-06)", () => {
  it("tabla y campos: coincidencia exacta con la Meta API, en el mismo orden", () => {
    expect(diffTable(META_LEADS, schemaTable("leads"), NAMES)).toEqual([]);
    expect(Object.keys(TABLES.leads.fields)).toEqual(Object.keys(NAMES));
    expect(Object.values(TABLES.leads.fields)).toEqual(META_LEADS.fields.map((f) => f.id));
    expect(TABLES.leads.fields.nombre).toBe(META_LEADS.primaryFieldId);
  });

  it("opciones de los selects exactas", () => {
    const choices = (name: string) => META_LEADS.fields.find((f) => f.name === name)!.choices;
    expect([...TABLES.leads.choices.tipo]).toEqual(choices("Tipo"));
    expect([...TABLES.leads.choices.status]).toEqual(choices("Status"));
    expect([...TABLES.leads.choices.origen]).toEqual(choices("Origen"));
  });

  it("Leads › Cliente apunta a Clientes y su inverso es Clientes › Leads", () => {
    const link = META_LEADS.fields.at(-1)!;
    expect(link.linkedTableId).toBe(TABLES.clientes.id);
    expect(link.inverseLinkFieldId).toBe(TABLES.clientes.fields.leads);
    expect(schemaTable("clientes").fields.leads).toBe("fldVOksrSGDYTcIaw");
  });

  it("sin campos calculados: solo tipos de dato", () => {
    for (const f of META_LEADS.fields) expect(["formula", "rollup", "lookup", "count"]).not.toContain(f.type);
  });
});
