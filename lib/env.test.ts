import { describe, expect, it } from "vitest";

import { EnvError, parseEnv } from "./env";

const valid = {
  AIRTABLE_TOKEN: "patXXXXXXXXXXXXXX.secret",
  AIRTABLE_BASE_ID: "appxGhn6qLbmWvMke",
  SESSION_SECRET: "a".repeat(44),
};

describe("parseEnv", () => {
  it("acepta un entorno completo", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("lista todas las variables faltantes en el mensaje", () => {
    try {
      parseEnv({ AIRTABLE_TOKEN: "x" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      const e = err as EnvError;
      expect(e.missing).toEqual(["AIRTABLE_BASE_ID", "SESSION_SECRET"]);
      expect(e.message).toContain("AIRTABLE_BASE_ID, SESSION_SECRET");
    }
  });

  it("trata strings vacíos como faltantes", () => {
    expect(() => parseEnv({ ...valid, AIRTABLE_TOKEN: "  " })).toThrow(/AIRTABLE_TOKEN/);
  });

  it("valida formato sin incluir el valor en el mensaje", () => {
    try {
      parseEnv({ ...valid, SESSION_SECRET: "cortito-secreto" });
      expect.unreachable();
    } catch (err) {
      const e = err as EnvError;
      expect(e.invalid).toEqual(["SESSION_SECRET"]);
      expect(e.message).not.toContain("cortito-secreto");
    }
    expect(() => parseEnv({ ...valid, AIRTABLE_BASE_ID: "Kairos" })).toThrow(/AIRTABLE_BASE_ID/);
  });
});
