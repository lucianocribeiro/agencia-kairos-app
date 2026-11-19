// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { Activity, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { Cargando, CARGANDO_APARECE, CARGANDO_DELAY_MS, CARGANDO_GIRO, CARGANDO_SIZE, CARGANDO_SRC, CARGANDO_TEMA, CARGANDO_TEXTO } = await import("./cargando");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const img = () => container.querySelector("img");
const status = () => container.querySelector('[role="status"]');
/** next/image sirve el PNG por el optimizador: /_next/image?url=%2Fklogo-transparente.png&w=…&q=… */
const servesK = (el: Element | null) => {
  const url = new URL(el?.getAttribute("src") ?? "", "http://x");
  return url.pathname === "/_next/image" && url.searchParams.get("url") === "/klogo-transparente.png";
};
const css = readFileSync("app/globals.css", "utf8");
const keyframes = /@keyframes cargando-aparece \{\s*from \{\s*opacity: 0;\s*visibility: hidden;\s*\}\s*to \{\s*opacity: 1;\s*visibility: visible;\s*\}\s*\}/;

describe("Indicador de carga (CC-F4-13)", () => {
  it("muestra la K (/klogo-transparente.png, 96×90), role=status y «Cargando…» para lectores de pantalla; la imagen es decorativa", () => {
    act(() => root.render(<Cargando />));
    expect(servesK(img())).toBe(true);
    expect(img()!.getAttribute("alt")).toBe("");
    expect(img()!.getAttribute("aria-hidden")).toBe("true");
    expect([img()!.getAttribute("width"), img()!.getAttribute("height")]).toEqual([String(CARGANDO_SIZE.width), String(CARGANDO_SIZE.height)]);
    expect(status()!.querySelector(".sr-only")!.textContent).toBe("Cargando…");
    expect(CARGANDO_TEXTO).toBe("Cargando…");
    // Centrado en el área de contenido.
    expect(status()!.className).toContain("items-center");
    expect(status()!.className).toContain("justify-center");
  });

  it("no se ve ni se anuncia antes de ~300 ms: aparición por CSS (visibility hidden + opacidad 0 durante 300 ms, después 150 ms)", () => {
    act(() => root.render(<Cargando />));
    expect(CARGANDO_DELAY_MS).toBe(300);
    expect(CARGANDO_APARECE).toBe("animate-[cargando-aparece_150ms_ease-out_300ms_both]");
    expect(status()!.className).toContain(CARGANDO_APARECE);
    // `both`: el estado inicial (oculto) se aplica durante toda la demora.
    expect(css).toMatch(keyframes);
  });

  it("la demora cuenta desde que se MUESTRA (sin timers de JS): una ruta revelada por <Activity> espera sus 300 ms", () => {
    const src = readFileSync("components/shell/cargando.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/setTimeout|useEffect|useState|"use client"/);
    act(() => root.render(<Activity mode="hidden"><Cargando /></Activity>));
    act(() => root.render(<Activity mode="visible"><Cargando /></Activity>));
    expect(status()!.className).toContain(CARGANDO_APARECE);
  });

  it("gira una vuelta cada 1,2 s, lineal; con prefers-reduced-motion queda quieta", () => {
    act(() => root.render(<Cargando />));
    expect(img()!.getAttribute("class")).toContain(CARGANDO_GIRO);
    expect(CARGANDO_GIRO).toBe("animate-[spin_1.2s_linear_infinite] motion-reduce:animate-none");
  });

  it("color por tema (CC-F4-13-FIX): PNG transparente con la K negra → blanca en oscuro (invert), negra en claro (light:invert-0)", () => {
    act(() => root.render(<Cargando />));
    expect(CARGANDO_SRC).toBe("/klogo-transparente.png");
    expect(CARGANDO_TEMA).toBe("invert light:invert-0");
    expect(img()!.getAttribute("class")).toBe(`${CARGANDO_GIRO} ${CARGANDO_TEMA}`);
    expect(container.innerHTML).not.toMatch(/brightness/);
    // public/klogo.png sigue en el repo como fuente, pero la app no lo usa.
    expect(readFileSync("public/klogo.png").length).toBeGreaterThan(0);
    expect(readFileSync("components/shell/cargando.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/["/]klogo\.png/);
  });

  it("se usa en el fallback de <Guarded> y en los loading.tsx de (admin), (empleado) y (cliente); no en (auth)", () => {
    expect(readFileSync("components/auth/guarded.tsx", "utf8")).toContain("<Suspense fallback={<Cargando />}>");
    for (const g of ["admin", "empleado", "cliente"]) expect(readFileSync(`app/(${g})/loading.tsx`, "utf8")).toContain("<Cargando />");
    expect(() => readFileSync("app/(auth)/loading.tsx", "utf8")).toThrow();
    expect(readFileSync("app/(auth)/cambiar-password/page.tsx", "utf8")).toContain("PageSkeleton");
  });
});
