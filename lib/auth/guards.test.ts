import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "./credentials";

const SECRET = "s".repeat(44);
const USER_ID = "recAAAAAAAAAAAAAA";
const PF = "0123456789abcdef";

// ── mocks ───────────────────────────────────────────────────────────────────
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));

class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
  unstable_rethrow: (err: unknown) => {
    if (err instanceof RedirectSignal) throw err;
  },
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ SESSION_SECRET: SECRET, AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "appxGhn6qLbmWvMke" }),
}));

let dbUser: AuthUser | null = null;
const loadAuthUser = vi.fn(async (id: string) => (id === USER_ID ? dbUser : null));
vi.mock("./credentials", () => ({ loadAuthUser: (id: string) => loadAuthUser(id) }));

const { requireAdmin, requireUser, AuthError } = await import("./guards");
const { apiRoute } = await import("./api");
const { signSessionToken } = await import("./token");
const { clearUserCache, invalidateCachedUser } = await import("./user-cache");
const { SESSION_COOKIE } = await import("./constants");

function user(over: Partial<AuthUser> = {}): AuthUser {
  return {
    id: USER_ID,
    nombre: "Ana",
    email: "ana@kairos.test",
    rol: "Admin",
    activo: true,
    debeCambiarPassword: false,
    pf: PF,
    ...over,
  };
}

async function loginAs(over: Partial<AuthUser> = {}, tokenPf = PF, iat?: number) {
  dbUser = user(over);
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId: USER_ID, pf: tokenPf }, SECRET, iat));
}

/** Corre el guard como si fuera un Route Handler envuelto en apiRoute. */
async function asApi(guard: () => Promise<unknown>) {
  const handler = apiRoute(async () => {
    await guard();
    return NextResponse.json({ ok: true });
  });
  return handler(new NextRequest("http://localhost/api/admin/ping"), {});
}

/** Corre el guard como página: devuelve a dónde redirige, o "ok". */
async function asPage(guard: () => Promise<unknown>) {
  try {
    await guard();
    return "ok";
  } catch (err) {
    if (err instanceof RedirectSignal) return err.to;
    throw err;
  }
}

beforeEach(() => {
  cookieJar.clear();
  clearUserCache();
  loadAuthUser.mockClear();
  dbUser = null;
});

describe("sin sesión", () => {
  it("API → 401 JSON", async () => {
    const res = await asApi(() => requireUser());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Tenés que iniciar sesión." });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("página → redirect /login", async () => {
    expect(await asPage(() => requireUser())).toBe("/login");
    expect(await asPage(() => requireAdmin())).toBe("/login");
  });
});

describe("rol", () => {
  it("Empleado en API de admin → 403 JSON", async () => {
    await loginAs({ rol: "Empleado" });
    const res = await asApi(() => requireAdmin());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "No tenés permiso para hacer esto." });
  });

  it("Empleado en página de admin → redirect /mis-horas", async () => {
    await loginAs({ rol: "Empleado" });
    expect(await asPage(() => requireAdmin())).toBe("/mis-horas");
    expect(await asPage(() => requireUser())).toBe("ok");
  });

  it("Admin pasa", async () => {
    await loginAs();
    expect((await asApi(() => requireAdmin())).status).toBe(200);
    expect(await asPage(() => requireAdmin())).toBe("ok");
  });
});

describe("Debe cambiar password", () => {
  beforeEach(() => loginAs({ debeCambiarPassword: true }));

  it("bloquea APIs con 403 y páginas con redirect a /cambiar-password", async () => {
    const api = await asApi(() => requireAdmin());
    expect(api.status).toBe(403);
    expect(await api.json()).toEqual({ error: "Tenés que cambiar la contraseña antes de seguir." });
    expect((await asApi(() => requireUser())).status).toBe(403);
    expect(await asPage(() => requireUser())).toBe("/cambiar-password");
    expect(await asPage(() => requireAdmin())).toBe("/cambiar-password");
  });

  it("deja pasar solo con allowPendingPasswordChange (página y API de cambio)", async () => {
    expect(await asPage(() => requireUser({ allowPendingPasswordChange: true }))).toBe("ok");
    expect((await asApi(() => requireUser({ allowPendingPasswordChange: true }))).status).toBe(200);
  });
});

describe("sesión inválida", () => {
  it("pf distinto (cambió la contraseña) → 401 y borra la cookie", async () => {
    await loginAs({}, "ffffffffffffffff");
    const res = await asApi(() => requireUser());
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0`, "i"));
  });

  it("pf distinto en página → pasa por /api/auth/expirada para borrar la cookie", async () => {
    await loginAs({}, "ffffffffffffffff");
    expect(await asPage(() => requireUser())).toBe("/api/auth/expirada");
  });

  it("usuario Inactivo o inexistente → inválida", async () => {
    await loginAs({ activo: false });
    expect((await asApi(() => requireUser())).status).toBe(401);
    clearUserCache();
    dbUser = null;
    expect((await asApi(() => requireUser())).status).toBe(401);
  });

  it("token vencido (más de 12 h) → inválida", async () => {
    await loginAs({}, PF, Math.floor(Date.now() / 1000) - 12 * 3600 - 5);
    expect((await asApi(() => requireUser())).status).toBe(401);
    expect(loadAuthUser).not.toHaveBeenCalled();
  });

  it("firma inválida → inválida", async () => {
    await loginAs();
    cookieJar.set(SESSION_COOKIE, `${cookieJar.get(SESSION_COOKIE)}x`);
    expect((await asApi(() => requireUser())).status).toBe(401);
  });
});

describe("caché de usuario (30 s, por instancia)", () => {
  it("reusa el usuario y se invalida con escrituras propias", async () => {
    await loginAs();
    await asApi(() => requireUser());
    await asApi(() => requireUser());
    expect(loadAuthUser).toHaveBeenCalledTimes(1);

    // cambio de contraseña en esta instancia: invalida y el pf viejo deja de valer
    dbUser = user({ pf: "aaaaaaaaaaaaaaaa" });
    invalidateCachedUser(USER_ID);
    expect((await asApi(() => requireUser())).status).toBe(401);
    expect(loadAuthUser).toHaveBeenCalledTimes(2);
  });
});

describe("apiRoute", () => {
  it("errores no controlados → 500 genérico", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await apiRoute(async () => {
      throw new Error("detalle interno");
    })(new NextRequest("http://localhost/api/x"), {});
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("detalle interno");
  });

  it("AuthError es una clase exportada", () => {
    expect(new AuthError(401, "x").status).toBe(401);
  });
});
