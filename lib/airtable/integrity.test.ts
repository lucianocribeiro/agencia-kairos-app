import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAirtable } from "@/test/fake-airtable";

const fake = createFakeAirtable();
vi.mock("./client", () => ({ getAirtableClient: () => fake.client }));

const { findDuplicates, findReferences, isUnique } = await import("./integrity");
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
