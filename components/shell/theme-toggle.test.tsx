// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readStoredTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY, writeStoredTheme } from "@/lib/theme";
import { ThemeSync, ThemeToggle } from "./theme-toggle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = document.documentElement;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  html.className = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const button = () => container.querySelector("button") as HTMLButtonElement;
const render = () => act(() => root.render(<><ThemeSync /><ThemeToggle /></>));
const runInitScript = () => new Function(THEME_INIT_SCRIPT)();

describe("script inline del <head>", () => {
  it("sin nada guardado: oscuro (sin clase)", () => {
    runInitScript();
    expect(html.classList.contains("light")).toBe(false);
  });

  it("guardado «light»: pone la clase antes de React", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    runInitScript();
    expect(html.classList.contains("light")).toBe(true);
  });

  it("valor desconocido: oscuro", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "azul");
    runInitScript();
    expect(html.classList.contains("light")).toBe(false);
  });

  it("localStorage tira: no rompe y queda oscuro", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    expect(() => runInitScript()).not.toThrow();
    expect(html.classList.contains("light")).toBe(false);
  });
});

describe("ThemeToggle", () => {
  it("default oscuro: ícono sol y «Cambiar a modo claro»", () => {
    render();
    expect(html.classList.contains("light")).toBe(false);
    expect(button().getAttribute("aria-label")).toBe("Cambiar a modo claro");
  });

  it("cambia la clase en los dos sentidos y lo guarda", () => {
    render();
    act(() => button().click());
    expect(html.classList.contains("light")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button().getAttribute("aria-label")).toBe("Cambiar a modo oscuro");

    act(() => button().click());
    expect(html.classList.contains("light")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(button().getAttribute("aria-label")).toBe("Cambiar a modo claro");
  });

  it("al montar respeta lo guardado (recarga)", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render();
    expect(html.classList.contains("light")).toBe(true);
    expect(button().getAttribute("aria-label")).toBe("Cambiar a modo oscuro");
  });

  it("localStorage falla: arranca oscuro, el botón igual cambia la clase y no rompe", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("lleno", "QuotaExceededError");
    });
    render();
    expect(html.classList.contains("light")).toBe(false);
    expect(() => act(() => button().click())).not.toThrow();
    expect(html.classList.contains("light")).toBe(true);
  });

  it("otra pestaña cambia el tema (evento storage)", () => {
    render();
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "light" }));
    });
    expect(html.classList.contains("light")).toBe(true);
    expect(button().getAttribute("aria-label")).toBe("Cambiar a modo oscuro");
  });
});

describe("lectura y escritura", () => {
  it("sin storage o con error → null / false", () => {
    expect(readStoredTheme(() => undefined)).toBeNull();
    expect(writeStoredTheme("light", () => undefined)).toBe(false);
    const broken = () => {
      throw new Error("x");
    };
    expect(readStoredTheme(broken)).toBeNull();
    expect(writeStoredTheme("light", broken)).toBe(false);
  });
});
