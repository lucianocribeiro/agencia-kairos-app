import { describe, expect, it } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { createFakeAirtable } from "./fake-airtable";

const H = TABLES.horas;

/**
 * El fake aplica los guards del cliente real: los tests de servicios y rutas fallan
 * si la app lee o escribe un campo que no está en schema.ts (como uno borrado de la
 * base, que Airtable respondería con 422 UNKNOWN_FIELD_NAME).
 */
describe("fake de Airtable: solo campos de schema.ts", () => {
  const { client } = createFakeAirtable();

  it("una lectura con un campo que no está en schema.ts (o es de otra tabla) falla", async () => {
    await expect(client.list(H.id, { fields: [H.fields.tarea, "fldNOEXISTE000000"] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.get(H.id, "recAAAAAAAAAAAAAA", { fields: [TABLES.ventas.fields.fecha] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.list(H.id, { fields: [H.fields.tarea, H.fields.numero] })).resolves.toEqual([]);
  });

  it("una escritura con un campo desconocido o que llena Airtable falla", async () => {
    await expect(client.create(H.id, [{ fldNOEXISTE000000: 1 }])).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.create(H.id, [{ [H.fields.creado]: "x" }])).rejects.toMatchObject({ code: "computed_field_write" });
    const [rec] = await client.create(H.id, [{ [H.fields.tarea]: "x" }]);
    await expect(client.update(H.id, [{ id: rec.id, fields: { [H.fields.numero]: 1 } }])).rejects.toMatchObject({ code: "computed_field_write" });
  });
});
