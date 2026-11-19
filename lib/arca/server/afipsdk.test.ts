import { describe, expect, it, vi } from "vitest";

import { createFakeAfipSdk } from "@/test/afipsdk-fixture";
import { AFIP_SDK_DETAIL_MAX, AfipSdkClient, AfipSdkError, afipSdkErrorResponse, createRejectionDetail, MAX_RESPONSE_BYTES, MENSAJE_RECHAZO, parseRetryAfter, readJsonCapped, sanitizeDetail } from "./afipsdk";

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
    expect(err.detail!.length).toBeLessThanOrEqual(300);
    expect(err.detail).toMatch(/^Usuario \[redactado\] o clave \[redactado\] incorrectos\./);
    expect(JSON.stringify(err)).not.toContain("incorrectos"); // toJSON no lleva el detalle
    expect(err.message).not.toContain("incorrectos");
    expect(afipSdkErrorResponse(err)).toEqual({ status: 400, error: err.detail });
  });

  it("job terminado con error (GET 400 o status error) → siempre el mensaje fijo (CC-F5-04 F-01)", async () => {
    const { fake, client } = setup();
    fake.onGet({ status: 400, body: { status: "error", data: { message: `La clave ${PARAMS.password} venció` } } });
    const err = await rejection(client.getJob("job-1"));
    expect(err.kind).toBe("rejected");
    expect(err.detail).toBe(MENSAJE_RECHAZO);
    fake.onGet({ status: 200, body: { status: "error", data: { message: `La clave ${PARAMS.password} venció` } } });
    expect(await client.getJob("job-1")).toEqual({ status: "error" });
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
    expect(sanitizeDetail("CUIT 20-11111111-2 y 30712345678 \nlínea", [])).toBe("CUIT [CUIT] y [CUIT] línea");
    expect(sanitizeDetail("la clave abc12345 no sirve", ["abc12345"])).toBe("la clave [redactado] no sirve");
    expect(sanitizeDetail("y".repeat(500))).toHaveLength(300);
    // Secretos cortos también se redactan (nunca se saltean por largo).
    expect(sanitizeDetail("clave: xy.", ["xy"])).toBe("clave: [redactado].");
    vi.restoreAllMocks();
  });
});

describe("CC-F5-04: mensajes del proveedor", () => {
  const creds = (password: string) => ({ username: PARAMS.username, password, cuit: PARAMS.cuit });

  it("create 400: clave de 1, 3 o 5 caracteres, o con caracteres de control → mensaje fijo", async () => {
    for (const clave of ["§", "§¶‡", "§¶‡µ¤", "abc\u0007defgh", "abcdefgh\u0000"]) {
      const { fake, client } = setup();
      fake.onCreate({ status: 400, body: { status: "error", data: { message: `Usuario o clave ${clave} incorrectos` } } });
      const err = await rejection(client.createJob({ ...PARAMS, password: clave }));
      expect(err.detail).toBe(MENSAJE_RECHAZO);
      expect(createRejectionDetail(`clave ${clave}`, creds(clave))).toBe(MENSAJE_RECHAZO);
    }
  });

  it("create 400 con clave ≥ 6: el mensaje limpio, sin la clave, la CUIT de login ni CUITs", () => {
    const clave = "Abc123xyz";
    expect(createRejectionDetail(`Usuario ${PARAMS.username} o clave ${clave} incorrectos`, creds(clave))).toBe("Usuario [redactado] o clave [redactado] incorrectos");
    expect(createRejectionDetail("CUIT 27-22222222-3 inexistente", creds(clave))).toBe("CUIT [CUIT] inexistente");
    expect(createRejectionDetail("Usuario 20-11111111-2 bloqueado", creds(clave))).toBe("Usuario [redactado] bloqueado");
    expect(createRejectionDetail(`eco ${clave.split("").join("\u0001")}`, creds(clave))).toBe("eco [redactado]");
    expect(createRejectionDetail(undefined, creds(clave))).toBe(MENSAJE_RECHAZO);
    expect(createRejectionDetail("\u0000\u0001", creds(clave))).toBe(MENSAJE_RECHAZO);
  });

  it("largo: 300 exactos quedan; 1.000 → ≤ 300 con el «…» incluido", () => {
    const clave = "Abc123xyz";
    const exact = "m".repeat(AFIP_SDK_DETAIL_MAX);
    expect(createRejectionDetail(exact, creds(clave))).toBe(exact);
    const long = createRejectionDetail("m".repeat(1000), creds(clave));
    expect(long.length).toBeLessThanOrEqual(AFIP_SDK_DETAIL_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("CC-F5-04: Retry-After", () => {
  const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
  it("segundos (tope 60) y HTTP-date futura; pasada, inválida o 0 → null", () => {
    expect(parseRetryAfter("2", NOW)).toBe(2000);
    expect(parseRetryAfter("120", NOW)).toBe(60_000);
    expect(parseRetryAfter(new Date(NOW + 5000).toUTCString(), NOW)).toBe(5000);
    expect(parseRetryAfter(new Date(NOW + 600_000).toUTCString(), NOW)).toBe(60_000);
    expect(parseRetryAfter(new Date(NOW - 5000).toUTCString(), NOW)).toBeNull();
    for (const bad of ["mañana", "-3", "1.5", "0", "", null, "2026-11-20"]) expect(parseRetryAfter(bad, NOW)).toBeNull();
  });

  it("en el cliente: HTTP-date futura se respeta; pasada o inválida → backoff normal", async () => {
    for (const [header, expected] of [[new Date(NOW + 3000).toUTCString(), 3000], [new Date(NOW - 3000).toUTCString(), null], ["basura", null], ["90", 60_000]] as const) {
      const fake = createFakeAfipSdk();
      const sleeps: number[] = [];
      const client = new AfipSdkClient({ token: "t", baseUrl: "https://afip.test/api/v1", fetch: fake.fetch, sleep: async (ms) => void sleeps.push(ms), now: () => NOW, baseDelayMs: 10 });
      fake.onGet({ status: 429, headers: { "retry-after": header } }, { status: 200, body: { status: "in_process" } });
      await client.getJob("job-1");
      if (expected === null) expect(sleeps[0]).toBeLessThan(13); // 10 · 2^0 + jitter
      else expect(sleeps[0]).toBe(expected);
    }
  });
});

describe("CC-F5-04: respuestas hostiles", () => {
  it("body de más de 8 MB → unexpected antes de JSON.parse (create y GET; con y sin Content-Length)", async () => {
    const big = `{"status":"complete","data":"${"x".repeat(MAX_RESPONSE_BYTES)}"}`;
    const huge: typeof fetch = async () => new Response(big, { status: 200 });
    const client = new AfipSdkClient({ token: "t", baseUrl: "https://afip.test/api/v1", fetch: huge, sleep: async () => {} });
    expect((await rejection(client.getJob("job-1"))).kind).toBe("unexpected");
    expect((await rejection(client.createJob(PARAMS))).kind).toBe("unexpected");
    const declared = new Response("{}", { status: 200, headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } });
    await expect(readJsonCapped(declared)).rejects.toMatchObject({ kind: "unexpected" });
    expect(await readJsonCapped(new Response('{"ok":1}'))).toEqual({ ok: 1 });
  });
});

describe("CC-F5-05: readJsonCapped con un stream que falla", () => {
  it("read rechaza → AfipSdkError(unexpected), el reader se libera y no se usa el body parcial", async () => {
    let cancelled = false;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls === 1) controller.enqueue(new TextEncoder().encode('{"status":"complete","data":[]}'));
        else throw new Error("conexión cortada");
      },
      cancel() {
        cancelled = true;
      },
    });
    const res = new Response(stream, { status: 200 });
    const err = await readJsonCapped(res).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(AfipSdkError);
    expect((err as AfipSdkError).kind).toBe("unexpected");
    expect(res.body!.locked).toBe(false);
    expect(cancelled || pulls === 2).toBe(true);
  });

  it("por el cliente: GET con un body que se corta → unexpected (no un job «complete» parcial)", async () => {
    const broken: typeof fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"status":"complete","data":[{"a":1}]}'));
            controller.error(new Error("corte"));
          },
        }),
        { status: 200 },
      );
    const client = new AfipSdkClient({ token: "t", baseUrl: "https://afip.test/api/v1", fetch: broken, sleep: async () => {} });
    expect((await rejection(client.getJob("job-1"))).kind).toBe("unexpected");
  });
});
