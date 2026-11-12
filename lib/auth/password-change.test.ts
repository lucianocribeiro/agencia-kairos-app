import bcrypt from "bcryptjs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { createFakeAirtable } from "@/test/fake-airtable";

const fake = createFakeAirtable();
vi.mock("@/lib/airtable/client", () => ({ getAirtableClient: () => fake.client }));

const { changePassword, PASSWORD_MESSAGES, validateNewPassword } = await import("./password-change");
const { attemptLogin } = await import("./login");
const { PASSWORD_POLICY_MESSAGES } = await import("./password-policy");
const { clearUserCache } = await import("./user-cache");

const U = TABLES.usuarios.fields;
const I = TABLES.intentosLogin;
const IP = "203.0.113.9";
const NOW = new Date("2026-11-12T15:00:00.000Z");
const ACTUAL = "actual-correcta";
const ok = { actual: ACTUAL, nueva: "nueva-clave-segura", repetir: "nueva-clave-segura" };

let hash: string;
let user: { id: string; email: string };
beforeAll(async () => {
  hash = await bcrypt.hash(ACTUAL, 4);
});
beforeEach(() => {
  fake.reset();
  clearUserCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const id = fake.seed(TABLES.usuarios.id, {
    [U.nombre]: "Ana",
    [U.email]: "ana@kairos.test",
    [U.rol]: "Empleado",
    [U.estado]: "Activo",
    [U.debeCambiarPassword]: true,
    [U.passwordHash]: hash,
  });
  user = { id, email: "ana@kairos.test" };
});
afterEach(() => vi.restoreAllMocks());

const attempts = () => fake.rows(I.id).map((r) => r.fields[I.fields.resultado]);
const change = (input: Partial<typeof ok>) => changePassword(user, { ...ok, ...input }, IP, NOW);

describe("validación", () => {
  it("reglas, incluida la de 72 bytes", () => {
    expect(validateNewPassword(ok)).toBeNull();
    expect(validateNewPassword({ ...ok, actual: "" })?.error).toBe(PASSWORD_MESSAGES.incompleto);
    expect(validateNewPassword({ ...ok, nueva: "corta", repetir: "corta" })).toMatchObject({ field: "nueva", error: PASSWORD_POLICY_MESSAGES.corta });
    const largo = "ñ".repeat(37); // 74 bytes
    expect(validateNewPassword({ ...ok, nueva: largo, repetir: largo })).toMatchObject({
      field: "nueva",
      error: "La contraseña no puede superar los 72 bytes (los caracteres con tilde o emojis ocupan más de uno).",
    });
    expect(validateNewPassword({ ...ok, repetir: "otra-distinta-x" })).toMatchObject({ field: "repetir" });
    expect(validateNewPassword({ actual: "misma-clave-123", nueva: "misma-clave-123", repetir: "misma-clave-123" })).toMatchObject({
      error: PASSWORD_MESSAGES.igual,
    });
  });
});

describe("cambio de contraseña", () => {
  it("éxito: guarda hash nuevo, apaga Debe cambiar password y devuelve pf", async () => {
    const result = await change({});
    expect(result).toMatchObject({ ok: true, pf: expect.stringMatching(/^[a-f0-9]{16}$/) });
    const fields = fake.rows(TABLES.usuarios.id)[0].fields;
    expect(fields[U.debeCambiarPassword]).toBe(false);
    expect(await bcrypt.compare(ok.nueva, String(fields[U.passwordHash]))).toBe(true);
  }, 20_000);

  it("actual incorrecta → 400 y registra Fallido con el email y la IP", async () => {
    expect(await change({ actual: "mal-mal-mal" })).toEqual({
      ok: false,
      status: 400,
      error: "La contraseña actual no es correcta.",
      field: "actual",
    });
    expect(fake.rows(I.id).map((r) => r.fields)).toEqual([
      { [I.fields.email]: "ana@kairos.test", [I.fields.ip]: IP, [I.fields.resultado]: "Fallido", [I.fields.fecha]: NOW.toISOString() },
    ]);
  });

  it("5 actuales incorrectas → la 6.ª da 429 y registra Bloqueado (aun con la correcta)", async () => {
    for (let i = 0; i < 5; i++) expect(await change({ actual: `mal-${i}-xxxx` })).toMatchObject({ status: 400 });
    expect(await change({})).toEqual({ ok: false, status: 429, error: "Demasiados intentos. Probá de nuevo en 15 minutos." });
    expect(attempts()).toEqual([...Array(5).fill("Fallido"), "Bloqueado"]);
    expect(fake.rows(TABLES.usuarios.id)[0].fields[U.passwordHash]).toBe(hash);
  });

  it("login y cambio de contraseña comparten el contador", async () => {
    for (let i = 0; i < 3; i++) await attemptLogin({ email: "ana@kairos.test", password: "mal", robot: true, ip: IP }, NOW);
    for (let i = 0; i < 2; i++) await change({ actual: `mal-${i}-xxxx` });
    expect(await attemptLogin({ email: "ana@kairos.test", password: ACTUAL, robot: true, ip: IP }, NOW)).toMatchObject({ status: 429 });
    expect(await change({})).toMatchObject({ status: 429 });
  });

  it("éxito registra Exitoso y reinicia el contador (N-01)", async () => {
    for (let i = 0; i < 3; i++) await change({ actual: `mal-${i}-xxxx` });
    expect(await change({})).toMatchObject({ ok: true });
    expect(attempts()).toEqual(["Fallido", "Fallido", "Fallido", "Exitoso"]);
    expect(fake.rows(I.id)[3].fields).toMatchObject({ [I.fields.email]: "ana@kairos.test", [I.fields.ip]: IP });
    // Logins fallidos 1 min después: 3 previos + 2 nuevos = 5; sin el reinicio, el 3.º daría 429.
    const later = new Date(NOW.getTime() + 60_000);
    for (let i = 0; i < 3; i++) {
      expect(await attemptLogin({ email: "ana@kairos.test", password: "mal", robot: true, ip: IP }, later)).toMatchObject({ status: 401 });
    }
  }, 20_000);

  it("si falla registrar el Exitoso, el cambio igual se aplica", async () => {
    fake.fail("create", I.id);
    expect(await change({})).toMatchObject({ ok: true });
    expect(fake.rows(TABLES.usuarios.id)[0].fields[U.debeCambiarPassword]).toBe(false);
  }, 20_000);

  it("si no se puede leer el bloqueo → 503 y no verifica ni cambia", async () => {
    fake.fail("list", I.id);
    expect(await change({})).toEqual({ ok: false, status: 503, error: "No pudimos validar el acceso. Probá de nuevo." });
    expect(fake.rows(TABLES.usuarios.id)[0].fields[U.passwordHash]).toBe(hash);
  });
});
