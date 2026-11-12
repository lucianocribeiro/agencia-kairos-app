import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "@/lib/auth/constants";
import { signSessionToken } from "@/lib/auth/token";
import { config, proxy } from "@/proxy";

const SECRET = "p".repeat(44);
beforeAll(() => {
  process.env.SESSION_SECRET = SECRET;
});

const req = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });

describe("proxy", () => {
  it("sin cookie → redirect /login", async () => {
    const res = await proxy(req("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("firma inválida → redirect /login y borra la cookie", async () => {
    const res = await proxy(req("/dashboard", "basura.basura.basura"));
    expect(res.headers.get("location")).toBe("http://localhost/login");
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
  });

  it("firma válida → sigue (la autorización real la hacen los guards)", async () => {
    const token = await signSessionToken({ userId: "recAAAAAAAAAAAAAA", pf: "0123456789abcdef" }, SECRET);
    const res = await proxy(req("/dashboard", token));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("/login es pública; /api y archivos quedan fuera del matcher", async () => {
    expect((await proxy(req("/login"))).headers.get("location")).toBeNull();
    const re = new RegExp(`^${config.matcher[0].replace("/((?!", "/(?!(?:").replace(").*)", ")).*")}$`);
    for (const path of ["/api/admin/ping", "/_next/static/x.js", "/Logo.png", "/icon.svg"]) expect(re.test(path)).toBe(false);
    for (const path of ["/", "/dashboard", "/maestros/clientes", "/login"]) expect(re.test(path)).toBe(true);
  });
});
