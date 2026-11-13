// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FilaListado } from "@/lib/ventas-compras/listado";
import type { ListadoInicial } from "./comprobantes-manager";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
const { ComprobantesManager } = await import("./comprobantes-manager");
const { ToastProvider } = await import("@/components/ui");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fila = (over: Partial<FilaListado>): FilaListado => ({
  id: "recCOMPROBANTE001",
  clave: "11|2|7|30711111118",
  datos: { fecha: "2026-10-15", tipo: "11 - Factura C", puntoVenta: 2, numeroDesde: 7, denominacionReceptor: "QA Cliente", nroDocReceptor: "30711111118", moneda: "$", impTotal: 1210 },
  importes: { total: 121000, iva: 21000, neto: 100000, impacto: 0, cuentaSocio: 0 },
  contraparte: { id: "recCLIENTE0000001", nombre: "QA Cliente" },
  mesDevengado: "2026-10-01",
  proyecto: null,
  unidadNegocio: null,
  categoria: null,
  socio: null,
  observaciones: "",
  guardado: { mesDevengado: "", proyecto: "", unidadNegocio: "", categoria: "", socio: "", observaciones: "" },
  control: "OK",
  ...over,
});

const INITIAL: ListadoInicial = {
  range: { desde: "2026-01-01", hasta: "2026-12-31" },
  filas: [fila({}), fila({ id: "recCOMPROBANTE002", clave: "11|2|8|30722222221", contraparte: null, control: "Cliente sin identificar" })],
  cantidad: 2,
  pagina: 1,
  paginas: 1,
  totales: { total: 242000, iva: 42000, neto: 200000, impacto: 0, cuentaSocio: 0 },
  opciones: {
    contrapartes: [],
    contexto: { proyectos: [], unidades: [], categorias: [], socios: [], categoriaVentasPorDefecto: { nombre: "Ingresos por servicios", id: null } },
  },
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.scrollTo = () => {};
  act(() =>
    root.render(
      <ToastProvider>
        <ComprobantesManager kind="ventas" today="2026-11-13" initial={INITIAL} />
      </ToastProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("ComprobantesManager", () => {
  it("totales del conjunto filtrado; filas con observaciones atenuadas (no en rojo)", () => {
    expect(container.textContent).toContain("2.420,00");
    expect(container.textContent).toContain("2.000,00");
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows[0].getAttribute("data-control")).toBe("ok");
    expect(rows[1].getAttribute("data-control")).toBe("observado");
    expect(rows[1].className).toContain("text-muted");
    expect(rows[1].innerHTML).not.toContain("text-danger");
  });

  it("borrar: el diálogo muestra Clave ARCA, Fecha, Denominación y Total $; Cancelar no borra; confirmar → DELETE", async () => {
    await act(async () => (container.querySelector('button[aria-label="Borrar 11|2|7|30711111118"]') as HTMLButtonElement).click());
    const dialog = document.querySelector('[role="alertdialog"]')!;
    for (const text of ["11|2|7|30711111118", "15/10/2026", "QA Cliente", "1.210,00"]) expect(dialog.textContent).toContain(text);
    await act(async () => ([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Cancelar") as HTMLButtonElement).click());
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => (container.querySelector('button[aria-label="Borrar 11|2|7|30711111118"]') as HTMLButtonElement).click());
    fetchMock.mockReturnValueOnce(json(200, { ok: true, id: "recCOMPROBANTE001" }));
    fetchMock.mockReturnValueOnce(json(200, { ok: true, ...INITIAL, filas: [INITIAL.filas[1]], cantidad: 1 }));
    await act(async () => ([...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === "Sí, borrar") as HTMLButtonElement).click());
    await act(async () => {});
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/comprobantes/ventas/recCOMPROBANTE001");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });
});
