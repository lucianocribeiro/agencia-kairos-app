// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Preview } from "@/lib/ventas-compras/types";

const { ImportManager, MAX_FILE_BYTES } = await import("./import-manager");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PREVIEW: Preview = {
  tipo: "ventas",
  filas: [
    {
      fila: 4,
      clave: "11|2|1|30111111118",
      estado: "nueva",
      error: null,
      datos: { fecha: "2026-10-15", tipo: "11 - Factura C", puntoVenta: 2, numeroDesde: 1, nroDocReceptor: "30111111118", denominacionReceptor: "QA", moneda: "$", impTotal: 1000 },
      codigo: 11,
      signo: 1,
      tipoComprobanteId: "recTIPO0000000011",
      importes: { total: 100000, iva: 0, otros: 0, neto: 100000 },
      mesFecha: "2026-10-01",
      clientePorCuit: null,
      proveedor: null,
    },
  ],
  contexto: {
    proyectos: [{ id: "recPROY000000000A", codigo: "QA - Web", activo: true, cliente: { id: "recCLI0000000000A", nombre: "QA Cliente" }, unidadNegocio: null }],
    unidades: [],
    categorias: [{ id: "recCAT00000000000", nombre: "Ingresos por servicios", tipo: "Ingreso", requiereProyecto: true }],
    socios: [],
    categoriaVentasPorDefecto: { nombre: "Ingresos por servicios", id: "recCAT00000000000" },
  },
  resumen: { total: 1, nuevas: 1, yaImportadas: 0, duplicadas: 0, conError: 0 },
  proveedoresNuevos: [],
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
  act(() => root.render(<ImportManager kind="ventas" />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const button = (text: RegExp) => [...container.querySelectorAll("button")].find((b) => text.test(b.textContent ?? ""))!;
async function chooseFile(file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

describe("ImportManager", () => {
  it("más de 4 MB: error sin llamar al servidor", async () => {
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "arca.xlsx");
    await chooseFile(big);
    await act(async () => button(/Ver vista previa/).click());
    expect(container.textContent).toContain("El archivo supera los 4 MB");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("vista previa: el Control se recalcula al elegir proyecto y la confirmación manda archivo + ediciones", async () => {
    await chooseFile(new File([new Uint8Array([0x50, 0x4b, 3, 4])], "arca.xlsx"));
    fetchMock.mockReturnValueOnce(json(200, { ok: true, ...PREVIEW }));
    await act(async () => button(/Ver vista previa/).click());
    await act(async () => {});
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/importar/ventas/preview");
    expect(container.textContent).toContain("Falta proyecto");
    expect(container.textContent).toContain("1.000,00");

    const select = container.querySelector('select[aria-label="Proyecto, fila 4"]') as HTMLSelectElement;
    await act(async () => {
      select.value = "recPROY000000000A";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("QA Cliente");
    expect(container.textContent).not.toContain("Falta proyecto");

    fetchMock.mockReturnValueOnce(json(200, { ok: true, importadas: 1, omitidas: { yaImportadas: 0, duplicadasEnArchivo: 0, enParalelo: 0 }, conError: [], proveedoresCreados: [] }));
    await act(async () => button(/Importar 1 comprobante/).click());
    await act(async () => {});
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/admin/importar/ventas/confirmar");
    const body = init.body as FormData;
    expect(body.get("archivo")).toBeInstanceOf(File);
    expect(JSON.parse(String(body.get("ediciones")))).toEqual({ "11|2|1|30111111118": { proyecto: "recPROY000000000A" } });
    expect(container.textContent).toContain("Importación terminada");
    expect(container.textContent).toMatch(/Importadas: 1/);
  });
});
