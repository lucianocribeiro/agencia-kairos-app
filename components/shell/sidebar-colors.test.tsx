// @vitest-environment jsdom
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

const { SidebarNav } = await import("./sidebar-nav");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * CC-F4-09-FIX: con la regla `a { color: inherit }` en `@layer base`, las clases de color de los
 * ítems sí se ven. Activo = `text-accent-text`; todos los inactivos (links y botones de grupo) = `text-muted`.
 */
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

const classes = (el: Element) => el.className.split(/\s+/);
const navItems = () => [...container.querySelectorAll('nav[aria-label="Menú principal"] > ul > li > :is(a, button)')];
const byLabel = (label: string) => navItems().find((el) => el.textContent?.trim() === label)!;

describe.each([
  ["expandido", false],
  ["colapsado", true],
])("sidebar %s: colores de activo e inactivos", (_l, collapsed) => {
  it("Dashboard activo usa accent-text; links e ítems de grupo inactivos, el mismo muted", () => {
    act(() => root.render(<SidebarNav role="Admin" pathname="/dashboard" collapsed={collapsed} headerAction={null} />));
    const active = byLabel("Dashboard");
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(classes(active)).toContain("text-accent-text");
    expect(classes(active)).not.toContain("text-muted");

    const idle = navItems().filter((el) => el !== active);
    expect(idle.map((el) => el.tagName)).toEqual(expect.arrayContaining(["A", "BUTTON"]));
    for (const el of idle) {
      expect(classes(el)).toContain("text-muted");
      expect(classes(el)).toContain("hover:text-text");
      expect(classes(el)).not.toContain("text-accent-text");
    }
  });
});

it("sub-ítem activo de un grupo (Ventas › Importar): accent-text; el resto de los sub-ítems, muted", () => {
  act(() => root.render(<SidebarNav role="Admin" pathname="/ventas/importar" collapsed={false} headerAction={null} />));
  const sub = [...container.querySelectorAll("nav ul ul a")];
  const active = sub.filter((a) => a.getAttribute("aria-current") === "page");
  expect(active).toHaveLength(1);
  expect(active[0].getAttribute("href")).toBe("/ventas/importar");
  expect(classes(active[0])).toContain("text-accent-text");
  for (const a of sub.filter((x) => x !== active[0])) expect(classes(a)).toContain("text-muted");
});
