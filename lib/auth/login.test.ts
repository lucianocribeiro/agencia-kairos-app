import bcrypt from "bcryptjs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAirtable } from "@/test/fake-airtable";
import { TABLES } from "@/lib/airtable/schema";

const fake = createFakeAirtable();
vi.mock("@/lib/airtable/client", () => ({ getAirtableClient: () => fake.client }));

const { attemptLogin, clientIp, LOGIN_MESSAGES } = await import("./login");
const { clearUserCache } = await import("./user-cache");

const U = TABLES.usuarios.fields;
const I = TABLES.intentosLogin;
const IF = I.fields;
const NOW = new Date("2026-11-12T15:00:00.000Z");
const IP = "203.0.113.7";
const PASSWORD = "contraseña-correcta";

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash(PASSWORD, 4); // costo bajo solo para tests
});

beforeEach(() => {
  fake.reset();
  clearUserCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function seedUser(over: Record<string, unknown> = {}) {
  return fake.seed(TABLES.usuarios.id, {
    [U.nombre]: "Ana Pérez",
    [U.email]: "Ana@Kairos.test",
    [U.rol]: "Empleado",
    [U.estado]: "Activo",
    [U.debeCambiarPassword]: false,
    [U.passwordHash]: hash,
    ...over,
  });
}

function seedAttempt(email: string, ip: string, resultado: string, minutesAgo: number) {
  fake.seed(I.id, {
    [IF.email]: email,
    [IF.ip]: ip,
    [IF.resultado]: resultado,
    [IF.fecha]: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  });
}

const attempts = () => fake.rows(I.id).map((r) => r.fields[IF.resultado]);
const login = (email: string, password: string, robot: unknown = true, ip = IP) =>
  attemptLogin({ email, password, robot, ip }, NOW);

describe("login · casilla No soy un robot", () => {
  it("rechaza con 400 y no registra nada", async () => {
    seedUser();
    for (const robot of [false, undefined, "true", "on", 1]) {
      expect(await attemptLogin({ email: "ana@kairos.test", password: PASSWORD, robot, ip: IP }, NOW)).toEqual({
        ok: false,
        status: 400,
        error: LOGIN_MESSAGES.robot,
      });
    }
    expect(LOGIN_MESSAGES.robot).toBe("Marcá la casilla «No soy un robot».");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("login · éxito", () => {
  it("normaliza el email, registra Exitoso, actualiza Último acceso y redirige por rol", async () => {
    const id = seedUser();
    const result = await login("  ANA@kairos.TEST ", PASSWORD);
    expect(result).toMatchObject({ ok: true, redirectTo: "/mis-horas", user: { id, rol: "Empleado" } });
    expect(attempts()).toEqual(["Exitoso"]);
    expect(fake.rows(I.id)[0].fields).toEqual({
      [IF.email]: "ana@kairos.test",
      [IF.ip]: IP,
      [IF.resultado]: "Exitoso",
      [IF.fecha]: NOW.toISOString(),
    });
    expect(fake.rows(TABLES.usuarios.id)[0].fields[U.ultimoAcceso]).toBe(NOW.toISOString());
  });

  it("Admin → /dashboard; Debe cambiar password → /cambiar-password", async () => {
    seedUser({ [U.email]: "admin@kairos.test", [U.rol]: "Admin" });
    seedUser({ [U.email]: "nuevo@kairos.test", [U.debeCambiarPassword]: true });
    expect(await login("admin@kairos.test", PASSWORD)).toMatchObject({ ok: true, redirectTo: "/dashboard" });
    expect(await login("nuevo@kairos.test", PASSWORD)).toMatchObject({ ok: true, redirectTo: "/cambiar-password" });
  });

  it("si falla la escritura en Intentos de login, el login sigue", async () => {
    seedUser();
    fake.fail("create", I.id);
    expect(await login("ana@kairos.test", PASSWORD)).toMatchObject({ ok: true });
  });

  it("nunca guarda la contraseña ni el hash en Intentos de login", async () => {
    seedUser();
    await login("ana@kairos.test", PASSWORD);
    await login("ana@kairos.test", "otra-cosa-mal");
    const dump = JSON.stringify(fake.rows(I.id));
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain(hash);
    expect(dump).not.toContain("otra-cosa-mal");
  });
});

describe("login · mismo 401 para email desconocido, contraseña mal o Inactivo", () => {
  it("devuelve exactamente la misma respuesta y registra Fallido", async () => {
    seedUser();
    seedUser({ [U.email]: "baja@kairos.test", [U.estado]: "Inactivo" });
    const expected = { ok: false, status: 401, error: "Email o contraseña incorrectos." };
    expect(await login("nadie@kairos.test", PASSWORD)).toEqual(expected);
    expect(await login("ana@kairos.test", "contraseña-mal")).toEqual(expected);
    expect(await login("baja@kairos.test", PASSWORD)).toEqual(expected);
    expect(attempts()).toEqual(["Fallido", "Fallido", "Fallido"]);
  });

  it("con email desconocido igual corre bcrypt (hash fijo)", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    await login("nadie@kairos.test", PASSWORD);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][1])).toMatch(/^\$2[aby]\$12\$/);
  });
});

describe("login · bloqueo por email", () => {
  it("5 Fallido en 15 min → el siguiente intento da 429 y registra Bloqueado", async () => {
    seedUser();
    for (let i = 0; i < 5; i++) {
      expect(await login("ana@kairos.test", "mal")).toMatchObject({ status: 401 });
    }
    const blocked = await login("ana@kairos.test", PASSWORD); // aun con la contraseña correcta
    expect(blocked).toEqual({ ok: false, status: 429, error: "Demasiados intentos. Probá de nuevo en 15 minutos." });
    expect(attempts()).toEqual([...Array(5).fill("Fallido"), "Bloqueado"]);
  });

  it("misma respuesta 429 para un email que no existe", async () => {
    for (let i = 0; i < 5; i++) seedAttempt("fantasma@kairos.test", "198.51.100.1", "Fallido", 1);
    expect(await login("fantasma@kairos.test", "x")).toEqual({
      ok: false,
      status: 429,
      error: LOGIN_MESSAGES.bloqueado,
    });
  });

  it("4 Fallido no bloquean", async () => {
    seedUser();
    for (let i = 0; i < 4; i++) seedAttempt("ana@kairos.test", "198.51.100.1", "Fallido", 2);
    expect(await login("ana@kairos.test", PASSWORD)).toMatchObject({ ok: true });
  });

  it("los Fallido de hace más de 15 min no cuentan (vence la ventana)", async () => {
    seedUser();
    for (let i = 0; i < 4; i++) seedAttempt("ana@kairos.test", IP, "Fallido", 16);
    seedAttempt("ana@kairos.test", IP, "Fallido", 14);
    expect(await login("ana@kairos.test", PASSWORD)).toMatchObject({ ok: true });
  });

  it("un Exitoso reinicia la cuenta: solo cuentan los Fallido posteriores", async () => {
    seedUser();
    for (let i = 0; i < 4; i++) seedAttempt("ana@kairos.test", IP, "Fallido", 10);
    seedAttempt("ana@kairos.test", IP, "Exitoso", 8);
    for (let i = 0; i < 4; i++) seedAttempt("ana@kairos.test", IP, "Fallido", 5);
    expect(await login("ana@kairos.test", PASSWORD)).toMatchObject({ ok: true });

    seedAttempt("ana@kairos.test", IP, "Fallido", 0);
    // ahora el último Exitoso es el de recién; otro Fallido posterior no alcanza
    expect(await login("ana@kairos.test", PASSWORD)).toMatchObject({ ok: true });
  });

  it("5 Fallido posteriores al último Exitoso sí bloquean", async () => {
    seedUser();
    seedAttempt("ana@kairos.test", IP, "Exitoso", 12);
    for (let i = 0; i < 5; i++) seedAttempt("ana@kairos.test", IP, "Fallido", 6);
    expect(await login("ana@kairos.test", PASSWORD)).toMatchObject({ status: 429 });
  });
});

describe("login · bloqueo por IP", () => {
  it("20 Fallido desde la misma IP → 429 para cualquier email", async () => {
    seedUser();
    for (let i = 0; i < 20; i++) seedAttempt(`otro${i}@kairos.test`, IP, "Fallido", 3);
    expect(await login("ana@kairos.test", PASSWORD)).toMatchObject({ status: 429 });
    // desde otra IP, el mismo usuario entra
    expect(await login("ana@kairos.test", PASSWORD, true, "192.0.2.50")).toMatchObject({ ok: true });
  });

  it("19 Fallido o Fallido viejos no bloquean", async () => {
    seedUser();
    for (let i = 0; i < 19; i++) seedAttempt(`otro${i}@kairos.test`, IP, "Fallido", 3);
    for (let i = 0; i < 10; i++) seedAttempt(`viejo${i}@kairos.test`, IP, "Fallido", 20);
    expect(await login("ana@kairos.test", PASSWORD)).toMatchObject({ ok: true });
  });

  it("la consulta filtra por ID de campo con input escapado", async () => {
    await login('x"@kairos.test', "y", true, '1.2.3.4") OR TRUE() OR ("');
    const formulas = fake.calls
      .filter((c) => c.method === "list" && c.tableId === I.id)
      .map((c) => String((c.options as { filterByFormula: unknown }).filterByFormula));
    expect(formulas).toHaveLength(2);
    expect(formulas[0]).toContain(`{${IF.email}} = "x\\"@kairos.test"`);
    expect(formulas[1]).toContain(`{${IF.ip}} = "1.2.3.4\\") OR TRUE() OR (\\""`);
    expect(formulas[1]).toContain(`{${IF.resultado}} = "Fallido"`);
  });
});

describe("login · falla cerrado", () => {
  it("si no se puede leer Intentos de login → 503 y no compara la contraseña", async () => {
    seedUser();
    fake.fail("list", I.id);
    const spy = vi.spyOn(bcrypt, "compare");
    expect(await login("ana@kairos.test", PASSWORD)).toEqual({
      ok: false,
      status: 503,
      error: "No pudimos validar el acceso. Probá de nuevo.",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("clientIp", () => {
  it("x-real-ip, si no el primer x-forwarded-for, si no desconocida", () => {
    expect(clientIp(new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-forwarded-for": " 2.2.2.2 , 3.3.3.3" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers())).toBe("desconocida");
  });
});
