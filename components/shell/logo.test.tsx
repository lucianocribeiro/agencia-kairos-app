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

const { Logo } = await import("./logo");
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

describe("<Logo>", () => {
  it("muestra /Logo.png (expandido y compacto)", () => {
    act(() => root.render(<Logo />));
    expect(img()?.getAttribute("src")).toBe("/Logo.png");
    expect(img()?.alt).toBe("Kairos");
    expect(container.firstElementChild!.className).toContain("w-32");

    act(() => root.render(<Logo compact />));
    expect(img()?.getAttribute("src")).toBe("/Logo.png");
    expect(container.firstElementChild!.className).toContain("w-10");
  });

  it("si el archivo falta (error al cargar) muestra el texto «Kairos» en el mismo espacio", () => {
    act(() => root.render(<Logo />));
    fireError();
    expect(img()).toBeNull();
    expect(container.textContent).toBe("Kairos");
    expect(container.firstElementChild!.className).toContain("w-32");
  });

  it("compacto: también cae al texto", () => {
    act(() => root.render(<Logo compact />));
    fireError();
    expect(img()).toBeNull();
    expect(container.textContent).toBe("Kairos");
    expect(container.firstElementChild!.className).toContain("w-10");
  });
});

describe("<SidebarNav> renderiza el logo", () => {
  it.each([
    ["expandido", false],
    ["colapsado", true],
  ])("%s", (_label, collapsed) => {
    act(() => root.render(<SidebarNav role="Admin" pathname="/dashboard" collapsed={collapsed} headerAction={null} />));
    const logo = container.querySelector('a[aria-label="Ir al inicio"] img');
    expect(logo?.getAttribute("src")).toBe("/Logo.png");
    expect(logo?.parentElement?.className).toContain(collapsed ? "w-10" : "w-32");
  });
});
