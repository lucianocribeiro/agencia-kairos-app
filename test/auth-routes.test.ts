import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { SESSION_COOKIE } from "@/lib/auth/constants";

const post = (path: string, body: string, type: string) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body,
    headers: { "content-type": type, cookie: `${SESSION_COOKIE}=lo-que-sea` },
  });

describe("POST /api/auth/logout (F-05)", () => {
  it("form-encoded → 415 y NO borra la cookie", async () => {
    const res = await logout(post("/api/auth/logout", "a=1", "application/x-www-form-urlencoded"), {});
    expect(res.status).toBe(415);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("text/plain y multipart → 415", async () => {
    expect((await logout(post("/api/auth/logout", "{}", "text/plain"), {})).status).toBe(415);
    expect((await logout(post("/api/auth/logout", "x", "multipart/form-data; boundary=x"), {})).status).toBe(415);
  });

  it("JSON malformado (con Content-Type application/json) → 400 y NO borra la cookie", async () => {
    const res = await logout(post("/api/auth/logout", "{no es json", "application/json"), {});
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("JSON → 200, borra la cookie y devuelve /login", async () => {
    const res = await logout(post("/api/auth/logout", "{}", "application/json"), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: "/login" });
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0.*HttpOnly`, "i"));
  });
});

describe("login también exige JSON (password usa el mismo readJsonBody)", () => {
  it("form-encoded → 415", async () => {
    expect((await login(post("/api/auth/login", "email=a", "application/x-www-form-urlencoded"), {})).status).toBe(415);
  });

  it("app/api/auth/password lee el body con readJsonBody", async () => {
    const { read } = await import("./source-files");
    expect(read("app/api/auth/password/route.ts")).toMatch(/readJsonBody\(request\)/);
  });

  it("JSON inválido → 400", async () => {
    expect((await login(post("/api/auth/login", "{no es json", "application/json"), {})).status).toBe(400);
  });
});
