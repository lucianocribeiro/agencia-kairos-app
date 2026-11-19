// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardAdminData } from "@/lib/horas/dashboard-admin";

const { DashboardView } = await import("./dashboard-view");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA: DashboardAdminData = {
  range: { desde: "2030-03-01", hasta: "2030-03-31" },
  grouping: "mensual",
  buckets: [{ key: "2030-03", label: "03/2030", desde: "2030-03-01", hasta: "2030-03-31" }],
  rows: [{ proyecto: { id: "recPPPPPPPPPPPPP1", codigo: "QZ - Web", estado: "Activo" }, values: [5], total: 5 }],
  columnTotals: [5],
  total: 5,
  proyectos: [{ id: "recPPPPPPPPPPPPP1", codigo: "QZ - Web", estado: "Activo" }],
  selected: [],
  clientes: [
    { id: "recCCCCCCCCCCCCC1", nombre: "QA Cliente Uno", sigla: "QZ" },
    { id: "recCCCCCCCCCCCCC2", nombre: "QA Cliente Dos", sigla: "QD" },
  ],
  cliente: null,
  estado: null,
  importes: {
    proyectos: [
      {
        id: "recPPPPPPPPPPPPP1",
        codigo: "QZ - Web",
        valorHora: 1000,
        moneda: "ARS",
        horas: 4,
        neto: 400000,
        iva: 84000,
        total: 484000,
        colaboradores: [{ nombre: "QA Uno", horas: 4, neto: 400000 }],
        estados: [{ estado: "Pendiente", horas: 4, neto: 400000, iva: 84000, total: 484000 }],
      },
    ],
    totales: [{ moneda: "ARS", neto: 400000, iva: 84000, total: 484000 }],
  },
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, ...DATA, cliente: "recCCCCCCCCCCCCC1" }), { status: 200, headers: { "content-type": "application/json" } })));
  vi.stubGlobal("fetch", fetchMock);
  act(() => root.render(<DashboardView today="2030-03-15" initial={DATA} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const selectByLabel = (label: string) => {
  const l = [...container.querySelectorAll("label")].find((x) => x.textContent?.trim().startsWith(label))!;
  return document.getElementById(l.htmlFor) as HTMLSelectElement;
};

describe("Dashboard (Admin) · importes (CC-F4-11)", () => {
  it("filtros Cliente y Estado, Excel y el bloque de importes con «Sólo horas facturables.»", () => {
    expect([...selectByLabel("Cliente").options].map((o) => o.textContent)).toEqual(["Todos", "QA Cliente Uno", "QA Cliente Dos"]);
    expect([...selectByLabel("Estado de facturación").options].map((o) => o.textContent)).toEqual(["Todos", "Pendiente", "Facturada", "Pagada"]);
    const excel = [...container.querySelectorAll("a")].find((a) => a.textContent?.includes("Descargar Excel"))!;
    expect(excel.getAttribute("href")).toBe("/api/admin/dashboard/excel?desde=2030-03-01&hasta=2030-03-31&agrupacion=mensual");
    expect(container.textContent).toContain("Sólo horas facturables.");
    for (const t of ["Importes por proyecto", "Detalle por colaborador · QZ - Web", "Totales por moneda"]) expect(container.textContent).toContain(t);
    expect(container.textContent).toContain("Estado: Pendiente");
  });

  it("elegir un cliente recarga con ?cliente= y vacía los proyectos elegidos", async () => {
    const s = selectByLabel("Cliente");
    await act(async () => {
      s.value = "recCCCCCCCCCCCCC1";
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/admin/dashboard/vista?desde=2030-03-01&hasta=2030-03-31&agrupacion=mensual&cliente=recCCCCCCCCCCCCC1");
    const excel = [...container.querySelectorAll("a")].find((a) => a.textContent?.includes("Descargar Excel"))!;
    expect(excel.getAttribute("href")).toContain("cliente=recCCCCCCCCCCCCC1");
  });
});
