import { describe, expect, it, vi } from "vitest";

const verifyPasswordById = vi.fn(async (_id: string, pw: string) => pw === "actual-correcta");
const setPassword = vi.fn(async () => "fedcba9876543210");
vi.mock("./credentials", () => ({
  verifyPasswordById: (id: string, pw: string) => verifyPasswordById(id, pw),
  setPassword: () => setPassword(),
}));

const { changePassword, PASSWORD_MESSAGES, validateNewPassword } = await import("./password-change");

const ok = { actual: "actual-correcta", nueva: "nueva-clave-segura", repetir: "nueva-clave-segura" };

describe("cambio de contraseña", () => {
  it("valida reglas", () => {
    expect(validateNewPassword(ok)).toBeNull();
    expect(validateNewPassword({ ...ok, actual: "" })?.error).toBe(PASSWORD_MESSAGES.incompleto);
    expect(validateNewPassword({ ...ok, nueva: "corta", repetir: "corta" })).toMatchObject({ field: "nueva", error: PASSWORD_MESSAGES.corta });
    expect(validateNewPassword({ ...ok, repetir: "otra-distinta-x" })).toMatchObject({ field: "repetir" });
    expect(validateNewPassword({ actual: "misma-clave-123", nueva: "misma-clave-123", repetir: "misma-clave-123" })).toMatchObject({
      error: PASSWORD_MESSAGES.igual,
    });
    expect(validateNewPassword({ ...ok, nueva: "a".repeat(73), repetir: "a".repeat(73) })).toMatchObject({ error: PASSWORD_MESSAGES.larga });
  });

  it("verifica la actual y devuelve el pf nuevo", async () => {
    expect(await changePassword("recAAAAAAAAAAAAAA", { ...ok, actual: "mal-mal-mal" })).toMatchObject({
      ok: false,
      field: "actual",
    });
    expect(setPassword).not.toHaveBeenCalled();
    expect(await changePassword("recAAAAAAAAAAAAAA", ok)).toEqual({ ok: true, pf: "fedcba9876543210" });
    expect(setPassword).toHaveBeenCalledTimes(1);
  });
});
