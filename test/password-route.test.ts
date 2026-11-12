import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/lib/auth/credentials";

/** POST /api/auth/password con una sesión válida simulada (guard real, cookie real firmada). */
const SECRET = "r".repeat(44);
const USER_ID = "recBBBBBBBBBBBBBB";
const PF = "abcdefabcdefabcd";
const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ SESSION_SECRET: SECRET, AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "appxGhn6qLbmWvMke" }),
}));
const user: AuthUser = {
  id: USER_ID,
  nombre: "Ana",
  email: "ana@kairos.test",
  rol: "Empleado",
  activo: true,
  debeCambiarPassword: true,
  pf: PF,
};
const verifyPasswordById = vi.fn(async () => true);
vi.mock("@/lib/auth/credentials", () => ({
  loadAuthUser: async (id: string) => (id === USER_ID ? user : null),
  verifyPasswordById: () => verifyPasswordById(),
  setPassword: async () => "0000000000000000",
}));

const { POST } = await import("@/app/api/auth/password/route");
const { SESSION_COOKIE } = await import("@/lib/auth/constants");
const { signSessionToken } = await import("@/lib/auth/token");

const req = (body: string, type: string) =>
  new NextRequest("http://localhost/api/auth/password", {
    method: "POST",
    body,
    headers: { "content-type": type, cookie: `${SESSION_COOKIE}=${cookieJar.get(SESSION_COOKIE)}` },
  });

beforeEach(async () => {
  cookieJar.set(SESSION_COOKIE, await signSessionToken({ userId: USER_ID, pf: PF }, SECRET));
  verifyPasswordById.mockClear();
});

describe("POST /api/auth/password con sesión válida", () => {
  it("JSON malformado (Content-Type application/json) → 400, sin verificar ni cambiar nada", async () => {
    const res = await POST(req('{"actual": "x", ', "application/json"), {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "El formato del pedido no es válido." });
    expect(verifyPasswordById).not.toHaveBeenCalled();
  });

  it("JSON que no es un objeto → 400", async () => {
    expect((await POST(req("[1,2]", "application/json"), {})).status).toBe(400);
    expect((await POST(req('"hola"', "application/json"), {})).status).toBe(400);
  });

  it("form-encoded → 415", async () => {
    expect((await POST(req("actual=x", "application/x-www-form-urlencoded"), {})).status).toBe(415);
  });

  it("sin sesión → 401 (el guard corre antes de leer el body)", async () => {
    cookieJar.clear();
    const res = await POST(
      new NextRequest("http://localhost/api/auth/password", { method: "POST", body: "{", headers: { "content-type": "application/json" } }),
      {},
    );
    expect(res.status).toBe(401);
  });
});
