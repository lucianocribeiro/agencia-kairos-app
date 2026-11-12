// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HoursBarChart, niceMax } from "./hours-bar-chart";

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

const data = [
  { key: "2026-11-02", label: "Sem 02/11", value: 12.5 },
  { key: "2026-11-09", label: "Sem 09/11", value: 0 },
  { key: "2026-11-16", label: "Sem 16/11", value: 3.25 },
];

describe("<HoursBarChart>", () => {
  it("una barra por período, enfocable, con nombre accesible y color accent", () => {
    act(() => root.render(<HoursBarChart data={data} title="Horas por período" />));
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Horas por período");
    const bars = [...container.querySelectorAll("rect")];
    expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual(["Sem 02/11: 12,50 h", "Sem 09/11: 0,00 h", "Sem 16/11: 3,25 h"]);
    for (const b of bars) {
      expect(b.getAttribute("tabindex")).toBe("0");
      expect(b.getAttribute("fill")).toBe("var(--color-accent)");
    }
    expect(Number(bars[0].getAttribute("height"))).toBeGreaterThan(Number(bars[2].getAttribute("height")));
    expect(Number(bars[1].getAttribute("height"))).toBe(0);
  });

  it("muestra el valor con hover o foco", () => {
    act(() => root.render(<HoursBarChart data={data} title="x" />));
    const valueTexts = () => [...container.querySelectorAll('text[font-weight="600"]')].map((t) => t.textContent);
    expect(valueTexts()).toEqual([]);
    act(() => container.querySelectorAll("rect")[2].dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    expect(valueTexts()).toEqual(["3,25"]);
  });

  it("escala del eje: 1, 2, 2,5 o 5 × 10^n", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(0.7)).toBe(1);
    expect(niceMax(12.5)).toBe(20);
    expect(niceMax(21)).toBe(25);
    expect(niceMax(160)).toBe(200);
  });
});
