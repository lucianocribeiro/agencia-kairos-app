import { afterEach, describe, expect, it, vi } from "vitest";

import { AirtableError } from "@/lib/airtable/errors";
import { injectFault } from "./fault-injection";

afterEach(() => vi.unstubAllEnvs());

describe("injectFault (solo smoke test con next dev)", () => {
  it("en producción nunca falla, aunque la variable esté puesta", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "cascade:clientes");
    expect(() => injectFault("cascade:clientes")).not.toThrow();
  });

  it("en tests (NODE_ENV=test) tampoco", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "cascade:clientes");
    expect(() => injectFault("cascade:clientes")).not.toThrow();
  });

  it("en development solo falla en los puntos nombrados", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KAIROS_FAULT_INJECTION", "cascade:proyectos:1, cascade:clientes");
    expect(() => injectFault("cascade:proyectos:0")).not.toThrow();
    expect(() => injectFault("cascade:proyectos:1")).toThrow(AirtableError);
    expect(() => injectFault("cascade:clientes")).toThrow(/Falla inyectada/);
    vi.stubEnv("KAIROS_FAULT_INJECTION", "");
    expect(() => injectFault("cascade:clientes")).not.toThrow();
  });
});
