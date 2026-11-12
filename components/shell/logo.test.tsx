// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { Logo, LOGO_SIZES } = await import("./logo");
const { SidebarNav } = await import("./sidebar-nav");

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
/** next/image sirve el PNG por el optimizador: /_next/image?url=%2FLogo.png&w=…&q=… */
const servesLogo = (el: Element | null) => {
  const url = new URL(el?.getAttribute("src") ?? "", "http://x");
  return url.pathname === "/_next/image" && url.searchParams.get("url") === "/Logo.png";
};
const fireError = () =>
  act(() => {
    img()!.dispatchEvent(new Event("error"));
  });

describe("public/Logo.png", () => {
  it("es un PNG real (magic bytes) versionado con la app", () => {
    const bytes = readFileSync(join(process.cwd(), "public", "Logo.png"));
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

describe("<Logo> (next/image)", () => {
  it("expandido: /Logo.png optimizado a 118×56, srcset 1x/2x", () => {
    act(() => root.render(<Logo />));
    expect(servesLogo(img())).toBe(true);
    expect(img()?.alt).toBe("Kairos");
    expect(img()?.getAttribute("width")).toBe(String(LOGO_SIZES.expanded.width));
    expect(img()?.getAttribute("height")).toBe(String(LOGO_SIZES.expanded.height));
    // Tamaño fijo: srcset 1x/2x (128 y 256 px de ancho), nunca el PNG de 1700 px.
    expect(img()?.getAttribute("srcset")).toBe("/_next/image?url=%2FLogo.png&w=128&q=75 1x, /_next/image?url=%2FLogo.png&w=256&q=75 2x");
    expect(container.firstElementChild!.className).toContain("w-[180px]");
  });

  it("compacto: 56×27 en una caja de 56×56", () => {
    act(() => root.render(<Logo compact />));
    expect(servesLogo(img())).toBe(true);
    expect(img()?.getAttribute("width")).toBe("56");
    expect(img()?.getAttribute("height")).toBe("27");
    expect(img()?.getAttribute("srcset")).toBe("/_next/image?url=%2FLogo.png&w=64&q=75 1x, /_next/image?url=%2FLogo.png&w=128&q=75 2x");
    expect(container.firstElementChild!.className).toContain("w-14");
  });

  it("eager (shell): carga inmediata con prioridad alta; por defecto lazy", () => {
    act(() => root.render(<Logo eager />));
    expect(img()?.getAttribute("loading")).toBe("eager");
    expect(img()?.getAttribute("fetchpriority")).toBe("high");
    act(() => root.render(<Logo />));
    expect(img()?.getAttribute("loading")).toBe("lazy");
  });

  it.each([
    ["expandido", false, "w-[180px]"],
    ["compacto", true, "w-14"],
  ])("%s: si el archivo falta (error al cargar) muestra «Kairos» en el mismo espacio", (_l, compact, box) => {
    act(() => root.render(<Logo compact={compact} />));
    fireError();
    expect(img()).toBeNull();
    expect(container.textContent).toBe("Kairos");
    expect(container.firstElementChild!.className).toContain(box);
  });
});

describe("<SidebarNav> renderiza el logo", () => {
  it.each([
    ["expandido", false],
    ["colapsado", true],
  ])("%s", (_label, collapsed) => {
    act(() => root.render(<SidebarNav role="Admin" pathname="/dashboard" collapsed={collapsed} headerAction={null} />));
    const logo = container.querySelector('a[aria-label="Ir al inicio"] img');
    expect(servesLogo(logo)).toBe(true);
    expect(logo?.getAttribute("width")).toBe(String(collapsed ? LOGO_SIZES.compact.width : LOGO_SIZES.expanded.width));
    expect(logo?.getAttribute("loading")).toBe("eager");
    expect(logo?.parentElement?.className).toContain(collapsed ? "w-14" : "w-[180px]");
  });
});
