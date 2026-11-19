import { describe, expect, it, vi } from "vitest";

import { createFakeAfipSdk } from "@/test/afipsdk-fixture";
import { AfipSdkClient, AfipSdkError, afipSdkErrorResponse, sanitizeDetail } from "./afipsdk";

const PARAMS = { cuit: "30712345678", username: "20111111112", password: "clave-secreta-123", t: "E" as const, fechaEmision: "01/10/2026 - 31/10/2026" };

function setup() {
  const fake = createFakeAfipSdk();
  const sleeps: number[] = [];
  const client = new AfipSdkClient({ token: "tok_afip", baseUrl: "https://afip.test/api/v1", fetch: fake.fetch, sleep: async (ms) => void sleeps.push(ms), baseDelayMs: 10 });
  return { fake, sleeps, client };
}

async function rejection(p: Promise<unknown>): Promise<AfipSdkError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AfipSdkError);
  return err as AfipSdkError;
}

describe("AfipSdkClient", () => {
  it("create → in_process → complete, con Bearer y el body documentado", async () => {
    const { fake, client } = setup();
    fake.onCreate({ status: 200, body: { status: "in_process", id: "1f2e3d4c-0000-4000-8000-000000000001" } });
    expect(await client.createJob(PARAMS)).toBe("1f2e3d4c-0000-4000-8000-000000000001");
    fake.onGet({ status: 200, body: { status: "in_process" } }, { status: 200, body: { id: "x", status: "complete", data: [{ a: 1 }] } });
    expect(await client.getJob("1f2e3d4c-0000-4000-8000-000000000001")).toEqual({ status: "in_process" });
    expect(await client.getJob("1f2e3d4c-0000-4000-8000-000000000001")).toEqual({ status: "complete", data: [{ a: 1 }] });
    expect(fake.requests[0]).toEqual({
      method: "POST",
      path: "/api/v1/automations",
      authorization: "Bearer tok_afip",
      body: { automation: "mis-comprobantes", params: { cuit: PARAMS.cuit, username: PARAMS.username, password: PARAMS.password, filters: { t: "E", fechaEmision: PARAMS.fechaEmision } } },
    });
    expect(fake.requests[1]).toMatchObject({ method: "GET", path: "/api/v1/automations/1f2e3d4c-0000-4000-8000-000000000001", body: undefined });
  });

  it("400 → rejected con data.message limpio (sin credenciales ni CUITs) y acotado", async () => {
    const { fake, client } = setup();
    fake.onCreate({ status: 400, body: { status: "error", data: { message: `Usuario ${PARAMS.username} o clave ${PARAMS.password} incorrectos. ${"x".repeat(400)}` } } });
    const err = await rejection(client.createJob(PARAMS));
    expect(err.kind).toBe("rejected");
    expect(err.status).toBe(400);
    expect(err.detail).not.toContain(PARAMS.username);
    expect(err.detail).not.toContain(PARAMS.password);
    expect(err.detail!.length).toBeLessThanOrEqual(301);
    expect(err.detail).toMatch(/^Usuario \[redactado\] o clave \[redactado\] incorrectos\./);
    expect(JSON.stringify(err)).not.toContain("incorrectos"); // toJSON no lleva el detalle
    expect(err.message).not.toContain("incorrectos");
    expect(afipSdkErrorResponse(err)).toEqual({ status: 400, error: err.detail });
  });

  it("job terminado con error (GET 400 o status error) → rejected / error", async () => {
    const { fake, client } = setup();
    fake.onGet({ status: 400, body: { status: "error", data: { message: "Clave fiscal vencida para 20-11111111-2" } } });
    const err = await rejection(client.getJob("job-1"));
    expect(err.kind).toBe("rejected");
    expect(err.detail).toBe("Clave fiscal vencida para [CUIT]");
    fake.onGet({ status: 200, body: { status: "error", data: { message: "Falló" } } });
    expect(await client.getJob("job-1")).toEqual({ status: "error", detail: "Falló" });
  });

  it("401/403 → config (503 «no está configurada correctamente»)", async () => {
    const { fake, client } = setup();
    fake.onCreate({ status: 401, body: { message: "bad token" } });
    const err = await rejection(client.createJob(PARAMS));
    expect(err.kind).toBe("config");
    expect(afipSdkErrorResponse(err)).toEqual({ status: 503, error: "La integración con ARCA no está configurada correctamente." });
    fake.onGet({ status: 403 });
    expect((await rejection(client.getJob("job-1"))).kind).toBe("config");
  });

  it("GET reintenta 429/5xx/red hasta 3 veces, con backoff y Retry-After", async () => {
    const { fake, client, sleeps } = setup();
    fake.onGet({ status: 429, headers: { "retry-after": "2" } }, { status: 503 }, "network", { status: 200, body: { status: "in_process" } });
    expect(await client.getJob("job-1")).toEqual({ status: "in_process" });
    expect(fake.requests).toHaveLength(4);
    expect(sleeps[0]).toBe(2000);
    expect(sleeps).toHaveLength(3);
    fake.reset();
    fake.onGet({ status: 500 });
    const err = await rejection(client.getJob("job-1"));
    expect(err.kind).toBe("unavailable");
    expect(fake.requests).toHaveLength(4); // 1 + 3 reintentos
    expect(afipSdkErrorResponse(err)).toEqual({ status: 503, error: "ARCA no respondió; probá de nuevo en unos minutos." });
  });

  it("create NUNCA se reintenta (429, 5xx, red)", async () => {
    for (const reply of [{ status: 429 }, { status: 502 }, "network" as const]) {
      const { fake, client, sleeps } = setup();
      fake.onCreate(reply, { status: 200, body: { status: "in_process", id: "job-2" } });
      expect((await rejection(client.createJob(PARAMS))).kind).toBe("unavailable");
      expect(fake.requests).toHaveLength(1);
      expect(sleeps).toEqual([]);
    }
  });

  it("timeout (AbortSignal) → unavailable, sin la causa", async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const client = new AfipSdkClient({ token: "t", baseUrl: "https://afip.test/api/v1", fetch: hang, timeoutMs: 20, sleep: async () => {} });
    const err = await rejection(client.createJob(PARAMS));
    expect(err.kind).toBe("unavailable");
    expect(err.message).not.toMatch(/abort|timeout/i);
  });

  it("respuestas raras → unexpected; ID de job inválido no arma URL", async () => {
    const { fake, client } = setup();
    fake.onCreate({ status: 200, body: { status: "in_process" } });
    expect((await rejection(client.createJob(PARAMS))).kind).toBe("unexpected");
    fake.onCreate({ status: 200, body: { status: "in_process", id: "../../x" } });
    expect((await rejection(client.createJob(PARAMS))).kind).toBe("unexpected");
    expect((await rejection(client.getJob("../admin"))).kind).toBe("unexpected");
    fake.onGet({ status: 200, body: "texto" });
    expect((await rejection(client.getJob("job-1"))).kind).toBe("unexpected");
  });

  it("un estado no documentado se trata como en proceso (lo corta el vencimiento)", async () => {
    const { fake, client } = setup();
    fake.onGet({ status: 200, body: { status: "queued" } });
    expect(await client.getJob("job-1")).toEqual({ status: "in_process" });
  });

  it("sin token → config", () => {
    expect(() => new AfipSdkClient({ token: "" })).toThrow(AfipSdkError);
  });
});

describe("sanitizeDetail", () => {
  it("saca secretos, CUITs con o sin guiones y controles; acota a 300", () => {
    expect(sanitizeDetail("CUIT 20-11111111-2 y 30712345678\nlínea", [])).toBe("CUIT [CUIT] y [CUIT] línea");
    expect(sanitizeDetail("la clave abc12345 no sirve", ["abc12345"])).toBe("la clave [redactado] no sirve");
    expect(sanitizeDetail("y".repeat(500))).toHaveLength(301);
    vi.restoreAllMocks();
  });
});
