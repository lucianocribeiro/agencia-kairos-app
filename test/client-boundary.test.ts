import { describe, expect, it } from "vitest";

import { forbiddenChains, isClientFile, isForbidden } from "./client-boundary-check";
import { sourceFiles } from "./source-files";

/**
 * Frontera cliente/servidor (N-04): desde ningún archivo "use client" se puede llegar
 * (transitivamente) a lib/airtable/**, lib/env.ts ni lib/auth/** salvo password-policy.ts.
 */
const clientFiles = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]
  .filter((f) => /\.(tsx?|jsx?|mjs)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .filter(isClientFile);

describe("frontera cliente/servidor", () => {
  it("encuentra los componentes cliente (el test no pasa vacío)", () => {
    expect(clientFiles).toEqual(expect.arrayContaining(["components/auth/logout-button.tsx", "components/shell/app-shell.tsx"]));
  });

  it.each(clientFiles)("%s no llega a código de servidor", (file) => {
    expect(forbiddenChains(file).map((c) => c.join(" → "))).toEqual([]);
  });

  it("qué cuenta como prohibido", () => {
    expect(isForbidden("lib/airtable/client.ts")).toBe(true);
    expect(isForbidden("lib/env.ts")).toBe(true);
    expect(isForbidden("lib/auth/password-hash.ts")).toBe(true);
    expect(isForbidden("lib/auth/constants.ts")).toBe(true);
    expect(isForbidden("lib/auth/password-policy.ts")).toBe(false);
    expect(isForbidden("lib/roles.ts")).toBe(false);
  });
});

describe("fixtures", () => {
  it("negativa: detecta el acceso directo y el transitivo", () => {
    const chains = forbiddenChains("test/fixtures/client-boundary/bad-client.tsx").map((c) => c.join(" → "));
    expect(chains.sort()).toEqual([
      "test/fixtures/client-boundary/bad-client.tsx → lib/auth/constants.ts",
      "test/fixtures/client-boundary/bad-client.tsx → test/fixtures/client-boundary/helper.ts → lib/env.ts",
    ]);
  });

  it("positiva: imports de tipos y password-policy pasan", () => {
    expect(forbiddenChains("test/fixtures/client-boundary/ok-client.tsx")).toEqual([]);
  });
});
