import { describe, expect, it } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { setupIntentosLogin, UPDATE_SCHEMA_MESSAGE } from "../scripts/lib/setup-intentos-login.mjs";

const T = TABLES.intentosLogin;
const F = T.fields;

function table(over: { id?: string; ipId?: string; drop?: string } = {}) {
  const fields = [
    { id: F.email, name: "Email", type: "singleLineText" },
    { id: over.ipId ?? F.ip, name: "IP", type: "singleLineText" },
    { id: F.resultado, name: "Resultado", type: "singleSelect", options: { choices: [{ name: "Fallido" }, { name: "Exitoso" }, { name: "Bloqueado" }] } },
    { id: F.fecha, name: "Fecha", type: "dateTime", options: { timeZone: "America/Argentina/Buenos_Aires" } },
  ].filter((f) => f.name !== over.drop);
  return { id: over.id ?? T.id, name: "Intentos de login", primaryFieldId: F.email, fields };
}
const other = { id: "tblzdplcR97Ltj6vi", name: "Usuarios", primaryFieldId: "fldB9W48Cav5XRObU", fields: [] };

/** fetch falso: GET devuelve `tables`; POST (crear) devuelve una tabla con IDs nuevos. Registra cada método. */
function fakeFetch(tables: unknown[]) {
  const methods: string[] = [];
  const fn = async (_url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    methods.push(method);
    if (method === "GET") return Response.json({ tables });
    if (method === "POST") {
      return Response.json({
        id: "tblNUEVANUEVA0000",
        name: "Intentos de login",
        primaryFieldId: "fldNUEVO000000001",
        fields: [{ id: "fldNUEVO000000001", name: "Email", type: "singleLineText" }],
      });
    }
    throw new Error(`método inesperado ${method}`);
  };
  return { fn: fn as unknown as typeof fetch, methods };
}

async function run(tables: unknown[], verifyOnly: boolean) {
  const fake = fakeFetch(tables);
  const out: string[] = [];
  const err: string[] = [];
  const code = await setupIntentosLogin({
    token: "patFAKE",
    baseId: "appxGhn6qLbmWvMke",
    verifyOnly,
    fetch: fake.fn,
    log: (s: string) => out.push(s),
    error: (s: string) => err.push(s),
  });
  return { code, methods: fake.methods, out: out.join("\n"), err: err.join("\n") };
}

describe("setup-intentos-login (N-03)", () => {
  it("--verify, tabla coincide → 0, solo GET", async () => {
    const r = await run([other, table()], true);
    expect(r.code).toBe(0);
    expect(r.methods).toEqual(["GET"]);
    expect(r.out).toContain("coincide con lib/airtable/schema.ts");
  });

  it("--verify, IDs distintos → 1 con los IDs reales, solo GET", async () => {
    const r = await run([table({ id: "tblOTRAOTRA00000x", ipId: "fldOTRO0000000001" })], true);
    expect(r.code).toBe(1);
    expect(r.methods).toEqual(["GET"]);
    expect(r.err).toContain(`tabla: real tblOTRAOTRA00000x ≠ schema.ts ${T.id}`);
    expect(r.err).toContain(`ip ("IP"): real fldOTRO0000000001 ≠ schema.ts ${F.ip}`);
    expect(r.err).toContain("IDs reales:");
  });

  it("--verify, falta un campo → 1, solo GET", async () => {
    const r = await run([table({ drop: "Fecha" })], true);
    expect(r.code).toBe(1);
    expect(r.methods).toEqual(["GET"]);
  });

  it("--verify, tabla inexistente → 1, solo GET (nunca POST)", async () => {
    const r = await run([other], true);
    expect(r.code).toBe(1);
    expect(r.methods).toEqual(["GET"]);
    expect(r.err).toContain("no existe (modo --verify: no se crea)");
  });

  it("sin --verify, tabla inexistente → exactamente un POST y 1 con «Actualizá schema.ts…»", async () => {
    const r = await run([other], false);
    expect(r.code).toBe(1);
    expect(r.methods).toEqual(["GET", "POST"]);
    expect(r.out).toContain("tblNUEVANUEVA0000");
    expect(r.err).toContain(UPDATE_SCHEMA_MESSAGE);
    expect(UPDATE_SCHEMA_MESSAGE).toBe("Actualizá schema.ts con estos IDs antes de usar la app.");
  });

  it("sin --verify, tabla que coincide → 0 sin POST", async () => {
    const r = await run([table()], false);
    expect(r.code).toBe(0);
    expect(r.methods).toEqual(["GET"]);
  });
});
