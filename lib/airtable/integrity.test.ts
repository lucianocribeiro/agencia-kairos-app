import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAirtable } from "@/test/fake-airtable";

const fake = createFakeAirtable();
vi.mock("./client", () => ({ getAirtableClient: () => fake.client }));

const { findDuplicates, findReferences, isUnique, losesUniqueRace } = await import("./integrity");
const T = "tblsf0Wa09QVk3vvR";
const NOMBRE = "fldlLmQ2W5WaHRep7";
const PROYECTOS = "fldEu1ghFqF8jtVMM";

beforeEach(() => fake.reset());

describe("findDuplicates", () => {
  it("fórmula LOWER(TRIM()) por ID de campo, escapada y excluyendo el registro editado", async () => {
    await findDuplicates(T, NOMBRE, '  Acme "SA" ', { excludeId: "recAAAAAAAAAAAAAA" });
    const formula = String((fake.calls[0].options as { filterByFormula: unknown }).filterByFormula);
    expect(formula).toBe(`AND(LOWER(TRIM({${NOMBRE}} & "")) = "acme \\"sa\\"", NOT(RECORD_ID() = "recAAAAAAAAAAAAAA"))`);
  });

  it("compara sin mayúsculas ni espacios y excluye al propio registro (también en código)", async () => {
    const a = fake.seed(T, { [NOMBRE]: "Acme" });
    fake.seed(T, { [NOMBRE]: "Otra" });
    expect(await findDuplicates(T, NOMBRE, " ACME ")).toEqual([{ id: a }]);
    expect(await isUnique(T, NOMBRE, "acme", { excludeId: a })).toBe(true);
    expect(await isUnique(T, NOMBRE, "nueva")).toBe(true);
    expect(await findDuplicates(T, NOMBRE, "   ")).toEqual([]);
  });
});

describe("findReferences", () => {
  it("devuelve los links no vacíos; null si no existe", async () => {
    const usado = fake.seed(T, { [NOMBRE]: "A", [PROYECTOS]: ["recPPPPPPPPPPPPPP", "recQQQQQQQQQQQQQQ"] });
    const libre = fake.seed(T, { [NOMBRE]: "B", [PROYECTOS]: [] });
    expect(await findReferences(T, usado, [PROYECTOS])).toEqual([{ fieldId: PROYECTOS, count: 2 }]);
    expect(await findReferences(T, libre, [PROYECTOS])).toEqual([]);
    expect(await findReferences(T, "recNOEXISTE000000", [PROYECTOS])).toBeNull();
  });
});

describe("losesUniqueRace (verificación después de escribir)", () => {
  it("sin otro registro con el valor → no pierde", async () => {
    const a = fake.seed(T, { [NOMBRE]: "Acme" });
    fake.seed(T, { [NOMBRE]: "Otra" });
    expect(await losesUniqueRace(T, NOMBRE, "acme", a, "create")).toBe(false);
    expect(await losesUniqueRace(T, NOMBRE, "acme", a, "edit")).toBe(false);
  });

  it("alta: pierde el createdTime más reciente; empate → el ID más alto", async () => {
    const viejo = fake.seed(T, { [NOMBRE]: "Acme" });
    const nuevo = fake.seed(T, { [NOMBRE]: " ACME " });
    fake.setCreatedTime(T, viejo, "2026-01-01T00:00:00.000Z");
    fake.setCreatedTime(T, nuevo, "2026-01-01T00:00:01.000Z");
    expect(await losesUniqueRace(T, NOMBRE, "Acme", nuevo, "create")).toBe(true);
    expect(await losesUniqueRace(T, NOMBRE, "Acme", viejo, "create")).toBe(false);

    fake.setCreatedTime(T, nuevo, "2026-01-01T00:00:00.000Z"); // empate
    const [low, high] = [viejo, nuevo].sort();
    expect(await losesUniqueRace(T, NOMBRE, "Acme", high, "create")).toBe(true);
    expect(await losesUniqueRace(T, NOMBRE, "Acme", low, "create")).toBe(false);
  });

  it("edición: si hay otro con el mismo valor, pierde siempre quien edita", async () => {
    const a = fake.seed(T, { [NOMBRE]: "Acme" });
    const b = fake.seed(T, { [NOMBRE]: "acme" });
    fake.setCreatedTime(T, a, "2020-01-01T00:00:00.000Z");
    expect(await losesUniqueRace(T, NOMBRE, "Acme", a, "edit")).toBe(true);
    expect(await losesUniqueRace(T, NOMBRE, "Acme", b, "edit")).toBe(true);
  });

  it("valor vacío → no aplica", async () => {
    expect(await losesUniqueRace(T, NOMBRE, "  ", "recAAAAAAAAAAAAAA", "create")).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});
