import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AFIP_SDK_URL, getArcaConfig, isArcaConfigured } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("configuración de ARCA (AFIP_SDK_TOKEN)", () => {
  it("sin token → no configurada (el resto de la app no depende de esto)", () => {
    vi.stubEnv("AFIP_SDK_TOKEN", "");
    expect(getArcaConfig()).toBeNull();
    expect(isArcaConfigured()).toBe(false);
  });

  it("con token → URL de Afip SDK", () => {
    vi.stubEnv("AFIP_SDK_TOKEN", "tok");
    expect(getArcaConfig()).toEqual({ token: "tok", baseUrl: DEFAULT_AFIP_SDK_URL });
  });

  it("AFIP_SDK_BASE_URL solo con NODE_ENV=development y solo localhost", () => {
    vi.stubEnv("AFIP_SDK_TOKEN", "tok");
    vi.stubEnv("AFIP_SDK_BASE_URL", "http://localhost:4010/api/v1/");
    vi.stubEnv("NODE_ENV", "production");
    expect(getArcaConfig()!.baseUrl).toBe(DEFAULT_AFIP_SDK_URL);
    vi.stubEnv("NODE_ENV", "test");
    expect(getArcaConfig()!.baseUrl).toBe(DEFAULT_AFIP_SDK_URL);
    vi.stubEnv("NODE_ENV", "development");
    expect(getArcaConfig()!.baseUrl).toBe("http://localhost:4010/api/v1");
    for (const bad of ["https://evil.example/api", "http://localhost.evil.example", "http://10.0.0.1:4010", "file:///etc/passwd"]) {
      vi.stubEnv("AFIP_SDK_BASE_URL", bad);
      expect(getArcaConfig()!.baseUrl).toBe(DEFAULT_AFIP_SDK_URL);
    }
  });
});
