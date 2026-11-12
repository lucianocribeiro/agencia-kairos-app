import { describe, expect, it, vi } from "vitest";

import { AirtableClient, AirtableError } from "./client";
import { eq } from "./formula";
import { TABLES } from "./schema";

const TOKEN = "patABCDEFGHIJKLMN.supersecretvalue";
const BASE = "appxGhn6qLbmWvMke";
const U = TABLES.usuarios;
const H = TABLES.horas;

type Call = { url: string; init: RequestInit };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function setup(responses: (Response | Error | ((call: Call) => Response))[]) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const next = queue.shift();
    if (!next) throw new Error("sin respuesta configurada");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(call) : next;
  });
  const sleeps: number[] = [];
  const client = new AirtableClient({
    token: TOKEN,
    baseId: BASE,
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => 0,
    baseDelayMs: 10,
  });
  const bodyOf = (i: number) => JSON.parse(String(calls[i].init.body));
  return { client, calls, sleeps, bodyOf, fetchMock };
}

const rec = (id: string, fields: Record<string, unknown> = {}) => ({ id, createdTime: "2026-01-01T00:00:00.000Z", fields });
const id = (n: number) => `rec${String(n).padStart(14, "0")}`;

describe("AirtableClient.list", () => {
  it("recorre todas las páginas y pide campos por ID", async () => {
    const { client, calls, bodyOf } = setup([
      json({ records: [rec(id(1))], offset: "itr1" }),
      json({ records: [rec(id(2))] }),
    ]);
    const records = await client.list(U.id, {
      fields: [U.fields.nombre, U.fields.email],
      filterByFormula: eq(U.fields.estado, "Activo"),
    });
    expect(records.map((r) => r.id)).toEqual([id(1), id(2)]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(`https://api.airtable.com/v0/${BASE}/${U.id}/listRecords`);
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(bodyOf(0)).toMatchObject({
      returnFieldsByFieldId: true,
      fields: [U.fields.nombre, U.fields.email],
      filterByFormula: `{${U.fields.estado}} = "Activo"`,
    });
    expect(bodyOf(0).offset).toBeUndefined();
    expect(bodyOf(1).offset).toBe("itr1");
  });

  it("exige `fields` con IDs de la tabla", async () => {
    const { client, fetchMock } = setup([]);
    await expect(client.list(U.id, { fields: [] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.list(U.id, { fields: ["Nombre"] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.list(U.id, { fields: [H.fields.tarea] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.list("Usuarios", { fields: [U.fields.nombre] })).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AirtableClient.get", () => {
  it("filtra por RECORD_ID y devuelve null si no existe", async () => {
    const { client, bodyOf } = setup([json({ records: [] })]);
    expect(await client.get(U.id, id(7), { fields: [U.fields.nombre] })).toBeNull();
    expect(bodyOf(0).filterByFormula).toBe(`RECORD_ID() = "${id(7)}"`);
    expect(bodyOf(0).maxRecords).toBe(1);
  });
});

describe("escrituras", () => {
  it("create en lotes de 10 y devuelve solo los campos escritos", async () => {
    const batchResponse = (call: Call) => {
      const body = JSON.parse(String(call.init.body)) as { records: { fields: Record<string, unknown> }[] };
      return json({
        records: body.records.map((r, i) => rec(id(i), { ...r.fields, [U.fields.passwordHash]: "hash" })),
      });
    };
    const { client, calls, bodyOf } = setup([batchResponse, batchResponse, batchResponse]);
    const input = Array.from({ length: 25 }, (_, i) => ({ [U.fields.nombre]: `U${i}` }));
    const out = await client.create(U.id, input);
    expect(calls).toHaveLength(3);
    expect(bodyOf(0).records).toHaveLength(10);
    expect(bodyOf(2).records).toHaveLength(5);
    expect(bodyOf(0).returnFieldsByFieldId).toBe(true);
    expect(out).toHaveLength(25);
    expect(out[0].fields).toEqual({ [U.fields.nombre]: "U0" });
  });

  it("update usa PATCH", async () => {
    const { client, calls, bodyOf } = setup([json({ records: [rec(id(1), { [U.fields.sigla]: "LR" })] })]);
    await client.update(U.id, [{ id: id(1), fields: { [U.fields.sigla]: "LR" } }]);
    expect(calls[0].init.method).toBe("PATCH");
    expect(bodyOf(0).records).toEqual([{ id: id(1), fields: { [U.fields.sigla]: "LR" } }]);
  });

  it("delete en lotes de 10", async () => {
    const ok = (call: Call) => {
      const ids = new URL(call.url).searchParams.getAll("records[]");
      return json({ records: ids.map((i) => ({ id: i, deleted: true })) });
    };
    const { client, calls } = setup([ok, ok]);
    const ids = Array.from({ length: 12 }, (_, i) => id(i));
    expect(await client.delete(H.id, ids)).toEqual(ids);
    expect(calls).toHaveLength(2);
    expect(calls[0].init.method).toBe("DELETE");
  });

  it("rechaza campos calculados sin llamar a la API", async () => {
    const { client, fetchMock } = setup([]);
    await expect(client.create(H.id, [{ [H.fields.tarea]: "x", [H.fields.importeAFacturar]: 10 }])).rejects.toMatchObject({
      code: "computed_field_write",
    });
    await expect(client.update(H.id, [{ id: id(1), fields: { [H.fields.creado]: "x" } }])).rejects.toMatchObject({
      code: "computed_field_write",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechaza links inversos y nombres de campo", async () => {
    const { client, fetchMock } = setup([]);
    await expect(client.update(U.id, [{ id: id(1), fields: { [U.fields.horasReverse]: [] } }])).rejects.toMatchObject({
      code: "read_only_field_write",
    });
    await expect(client.create(U.id, [{ Nombre: "x" }])).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reintentos y throttle", () => {
  it("reintenta 429 y 5xx con backoff exponencial", async () => {
    const { client, calls, sleeps } = setup([
      json({ errors: [] }, 429),
      json({}, 503),
      json({ records: [rec(id(1))] }),
    ]);
    const out = await client.list(U.id, { fields: [U.fields.nombre] });
    expect(out).toHaveLength(1);
    expect(calls).toHaveLength(3);
    const backoffs = sleeps.filter((ms) => ms >= 10);
    expect(backoffs[0]).toBeGreaterThanOrEqual(10);
    expect(backoffs[1]).toBeGreaterThanOrEqual(20);
  });

  it("respeta Retry-After", async () => {
    const { client, sleeps } = setup([json({}, 429, { "retry-after": "30" }), json({ records: [] })]);
    await client.list(U.id, { fields: [U.fields.nombre] });
    expect(sleeps).toContain(30_000);
  });

  it("se rinde después de 3 reintentos", async () => {
    const { client, calls } = setup([json({}, 500), json({}, 500), json({}, 500), json({ error: { type: "SERVER_ERROR" } }, 500)]);
    await expect(client.list(U.id, { fields: [U.fields.nombre] })).rejects.toMatchObject({
      code: "server_error",
      status: 500,
    });
    expect(calls).toHaveLength(4);
  });

  it("no reintenta 4xx", async () => {
    const { client, calls } = setup([json({ error: { type: "INVALID_PERMISSIONS", message: "nope" } }, 403)]);
    await expect(client.list(U.id, { fields: [U.fields.nombre] })).rejects.toMatchObject({
      code: "forbidden",
      airtableType: "INVALID_PERMISSIONS",
    });
    expect(calls).toHaveLength(1);
  });

  it("no reintenta errores de red en escrituras", async () => {
    const { client, calls } = setup([new TypeError("fetch failed")]);
    await expect(client.create(U.id, [{ [U.fields.nombre]: "x" }])).rejects.toMatchObject({ code: "network_error" });
    expect(calls).toHaveLength(1);
  });

  it("como máximo 5 requests por segundo", async () => {
    const page = () => json({ records: [] });
    const { client, sleeps } = setup(Array.from({ length: 6 }, () => page));
    await Promise.all(Array.from({ length: 6 }, () => client.list(U.id, { fields: [U.fields.nombre] })));
    expect(sleeps).toEqual([200, 400, 600, 800, 1000]);
  });
});

describe("AirtableError", () => {
  it("nunca expone el token", async () => {
    const { client } = setup([
      json({ error: { type: "AUTHENTICATION_REQUIRED", message: `Token ${TOKEN} inválido` } }, 401),
    ]);
    const err = await client.list(U.id, { fields: [U.fields.nombre] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AirtableError);
    const e = err as AirtableError;
    expect(e.code).toBe("unauthorized");
    expect(e.message).not.toContain(TOKEN);
    expect(JSON.stringify(e)).not.toContain(TOKEN);
    expect(String(e.stack)).not.toContain(TOKEN);
    expect(e.cause).toBeUndefined();
  });
});

describe("reintentos en escrituras (F-06)", () => {
  const ok = (call: Call) => {
    const body = call.init.body ? JSON.parse(String(call.init.body)) : null;
    if (call.init.method === "DELETE") {
      return json({ records: new URL(call.url).searchParams.getAll("records[]").map((i) => ({ id: i, deleted: true })) });
    }
    return json({ records: (body?.records ?? []).map((r: { id?: string; fields: Record<string, unknown> }, i: number) => rec(r.id ?? id(i), r.fields)) });
  };

  it("create: 429 NO se reintenta (la doc no garantiza que no se aplicó)", async () => {
    const { client, calls } = setup([json({}, 429, { "retry-after": "30" })]);
    await expect(client.create(U.id, [{ [U.fields.nombre]: "x" }])).rejects.toMatchObject({ code: "rate_limited" });
    expect(calls).toHaveLength(1);
  });

  it("create: 5xx NO se reintenta", async () => {
    const { client, calls } = setup([json({}, 503)]);
    await expect(client.create(U.id, [{ [U.fields.nombre]: "x" }])).rejects.toMatchObject({ code: "server_error" });
    expect(calls).toHaveLength(1);
  });

  it("create: error de red NO se reintenta", async () => {
    const { client, calls } = setup([new TypeError("fetch failed")]);
    await expect(client.create(U.id, [{ [U.fields.nombre]: "x" }])).rejects.toMatchObject({ code: "network_error" });
    expect(calls).toHaveLength(1);
  });

  it("update: reintenta 429 y 5xx", async () => {
    const { client, calls } = setup([json({}, 429), json({}, 502), ok]);
    const out = await client.update(U.id, [{ id: id(1), fields: { [U.fields.sigla]: "LR" } }]);
    expect(out).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.init.method === "PATCH")).toBe(true);
  });

  it("update: error de red no se reintenta", async () => {
    const { client, calls } = setup([new TypeError("fetch failed")]);
    await expect(client.update(U.id, [{ id: id(1), fields: { [U.fields.sigla]: "LR" } }])).rejects.toMatchObject({
      code: "network_error",
    });
    expect(calls).toHaveLength(1);
  });

  it("delete: reintenta 429 y 5xx, hasta 3 veces", async () => {
    const { client, calls } = setup([json({}, 500), json({}, 429), ok]);
    expect(await client.delete(H.id, [id(1)])).toEqual([id(1)]);
    expect(calls).toHaveLength(3);

    const giveUp = setup([json({}, 500), json({}, 500), json({}, 500), json({}, 500)]);
    await expect(giveUp.client.delete(H.id, [id(1)])).rejects.toMatchObject({ code: "server_error" });
    expect(giveUp.calls).toHaveLength(4);
  });

  it("lecturas: sin cambios (reintentan 429, 5xx y red)", async () => {
    const { client, calls } = setup([new TypeError("fetch failed"), json({}, 429), json({}, 500), json({ records: [] })]);
    expect(await client.list(U.id, { fields: [U.fields.nombre] })).toEqual([]);
    expect(calls).toHaveLength(4);
  });
});
