// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGOUT_ERROR, LogoutButton, requestLogout } from "./logout-button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("requestLogout", () => {
  it("2xx → destino; manda JSON", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { redirectTo: "/login" }));
    expect(await requestLogout(fetchMock as unknown as typeof fetch)).toBe("/login");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("no-2xx o error de red → null", async () => {
    expect(await requestLogout((async () => jsonResponse(500, {})) as unknown as typeof fetch)).toBeNull();
    expect(await requestLogout((async () => jsonResponse(415, {})) as unknown as typeof fetch)).toBeNull();
    expect(
      await requestLogout((async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch),
    ).toBeNull();
  });

  it("ignora destinos que no sean rutas internas", async () => {
    expect(await requestLogout((async () => jsonResponse(200, { redirectTo: "https://otro.sitio" })) as unknown as typeof fetch)).toBe(
      "/login",
    );
  });
});

describe("<LogoutButton>", () => {
  let container: HTMLDivElement;
  let root: Root;
  const navigate = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    navigate.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const button = () => container.querySelector("button")!;
  const click = async () => {
    await act(async () => {
      button().click();
    });
  };

  it("éxito → navega a /login y no muestra error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { redirectTo: "/login" })));
    act(() => root.render(<LogoutButton navigate={navigate} />));
    await click();
    expect(navigate).toHaveBeenCalledWith("/login");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("no-2xx → no navega, muestra el error y deja reintentar", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(500, { error: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    act(() => root.render(<LogoutButton navigate={navigate} />));
    await click();
    expect(navigate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(LOGOUT_ERROR);
    expect(button().disabled).toBe(false);

    // reintento exitoso
    fetchMock.mockImplementation(async () => jsonResponse(200, { redirectTo: "/login" }));
    await click();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("error de red → no navega y muestra el error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    act(() => root.render(<LogoutButton navigate={navigate} />));
    await click();
    expect(navigate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("No pudimos cerrar la sesión. Probá de nuevo.");
    expect(button().disabled).toBe(false);
  });
});
