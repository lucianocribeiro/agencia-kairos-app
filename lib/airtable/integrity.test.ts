import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAirtable } from "@/test/fake-airtable";

const fake = createFakeAirtable();
vi.mock("./client", () => ({ getAirtableClient: () => fake.client }));

const { findDuplicates, findReferences, findUniqueRaceLosers, isUnique, losesUniqueRace, WrittenRecordMissingError } = await import("./integrity");
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

describe("losesUniqueRace · registro escrito ausente (F1-04-01)", () => {
  it("si la relectura no trae el registro escrito, lanza (lectura fallida), con o sin otros iguales", async () => {
    await expect(losesUniqueRace(T, NOMBRE, "Acme", "recNOESTA00000001", "create")).rejects.toBeInstanceOf(WrittenRecordMissingError);
    fake.seed(T, { [NOMBRE]: "Acme" });
    await expect(losesUniqueRace(T, NOMBRE, "Acme", "recNOESTA00000001", "edit")).rejects.toThrow(/recNOESTA00000001/);
  });
});

describe("findUniqueRaceLosers (altas masivas)", () => {
  it("gana el más viejo (empate: ID más bajo); pierden todos los demás, con una sola lectura", async () => {
    const viejo = fake.seed(T, { [NOMBRE]: "11|2|1|30" });
    const a = fake.seed(T, { [NOMBRE]: "11|2|1|30" });
    const b = fake.seed(T, { [NOMBRE]: " 11|2|1|30 " });
    const solo = fake.seed(T, { [NOMBRE]: "11|2|2|30" });
    fake.setCreatedTime(T, viejo, "2026-11-01T10:00:00.000Z");
    fake.setCreatedTime(T, a, "2026-11-01T10:00:01.000Z");
    fake.setCreatedTime(T, b, "2026-11-01T10:00:01.000Z");
    fake.setCreatedTime(T, solo, "2026-11-01T10:00:01.000Z");
    fake.calls.length = 0;
    const losers = await findUniqueRaceLosers(T, NOMBRE, [
      { id: a, value: "11|2|1|30" },
      { id: b, value: "11|2|1|30" },
      { id: solo, value: "11|2|2|30" },
    ]);
    expect(losers.sort()).toEqual([a, b].sort());
    expect(fake.calls.filter((c) => c.method === "list")).toHaveLength(1);
    // con dos: el mismo resultado que losesUniqueRace en un alta
    expect(await findUniqueRaceLosers(T, NOMBRE, [{ id: viejo, value: "11|2|1|30" }])).toEqual([]);
  });

  it("si la relectura no trae un registro escrito → WrittenRecordMissingError; sin escritos no lee", async () => {
    fake.calls.length = 0;
    expect(await findUniqueRaceLosers(T, NOMBRE, [])).toEqual([]);
    expect(fake.calls).toHaveLength(0);
    await expect(findUniqueRaceLosers(T, NOMBRE, [{ id: "recNOEXISTE000000", value: "x" }])).rejects.toBeInstanceOf(WrittenRecordMissingError);
  });
});
