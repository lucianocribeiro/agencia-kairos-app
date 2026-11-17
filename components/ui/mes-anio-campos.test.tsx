// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FilaListado } from "@/lib/ventas-compras/listado";
import type { Preview } from "@/lib/ventas-compras/types";
import type { ListadoInicial } from "@/components/comprobantes/comprobantes-manager";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
const { ReportView } = await import("@/components/reportes/report-view");
const { ProformaView } = await import("@/components/proforma/proforma-view");
const { ComprobantesManager } = await import("@/components/comprobantes/comprobantes-manager");
const { ImportManager } = await import("@/components/importar/import-manager");
const { ToastProvider } = await import("@/components/ui");
const { query } = await import("@/components/horas/api");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * CC-F4-07: los 6 campos de mes con los selects Mes + Año mandan exactamente lo mismo que el
 * `<input type="month">` de antes. «Antes» = el mismo formulario con el input nativo (jsdom) o la
 * misma construcción de la URL/el body que ya usaba cada pantalla.
 */
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
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (el: ReactNode) => act(() => root.render(el));
const sel = (label: string) => container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const pick = (s: HTMLSelectElement, v: string) =>
  act(async () => {
    s.value = v;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
const marzo2030 = async (label: string) => {
  await pick(sel(`${label}: mes`), "03");
  await pick(sel(`${label}: año`), "2030");
};
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const queryString = (form: HTMLFormElement) => new URLSearchParams(new FormData(form) as unknown as Record<string, string>).toString();
/** Lo que mandaba el formulario con el input nativo: mismo HTML con `<input type="month">`. */
function nativo(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return queryString(div.querySelector("form")!);
}
function submit(form: HTMLFormElement): boolean {
  const e = new Event("submit", { cancelable: true, bubbles: true });
  act(() => {
    form.dispatchEvent(e);
  });
  return e.defaultPrevented;
}

describe("1. Reportes · Mes inicial (GET ?desde=AAAA-MM)", () => {
  const vista = { titulo: "Resultados", lineas: [], avisos: [], error: null, tablas: [] };
  it("precarga el mes del Parámetro / ?desde, misma acción y mismo query string que el input nativo", async () => {
    await render(<ReportView slug="resultados" vista={vista} desde="2026-01" />);
    const form = container.querySelector("form")!;
    expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["get", "/reportes/resultados"]);
    expect([sel("Mes inicial: mes").value, sel("Mes inicial: año").value]).toEqual(["01", "2026"]);
    expect(queryString(form)).toBe(nativo('<form><input type="month" name="desde" value="2026-01"></form>'));
    await marzo2030("Mes inicial");
    expect(queryString(form)).toBe("desde=2030-03");
    expect(queryString(form)).toBe(nativo('<form><input type="month" name="desde" value="2030-03"></form>'));
    expect(submit(form)).toBe(false);
  });

  it("obligatorio: vacío o a medias no se envía", async () => {
    await render(<ReportView slug="resultados" vista={vista} desde="2026-01" />);
    const form = container.querySelector("form")!;
    await pick(sel("Mes inicial: año"), "");
    expect(submit(form)).toBe(true);
    expect(container.textContent).toContain("Completá mes y año.");
    await pick(sel("Mes inicial: mes"), "");
    expect(submit(form)).toBe(true);
  });
});

describe("2. Proforma · Mes a facturar (GET ?cliente=…&mes=AAAA-MM)", () => {
  const clientes = [{ id: "recCLIENTE0000001", nombre: "QA Cliente" }];
  it("mismo query string (y orden) que el input nativo; obligatorio", async () => {
    await render(<ProformaView clientes={clientes} cliente="recCLIENTE0000001" mes="2026-10" data={null} error={null} />);
    const form = container.querySelector("form")!;
    expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["get", "/reportes/proforma"]);
    expect([sel("Mes a facturar: mes").value, sel("Mes a facturar: año").value]).toEqual(["10", "2026"]);
    await marzo2030("Mes a facturar");
    const antes = nativo('<form><select name="cliente"><option value="recCLIENTE0000001" selected>QA</option></select><input type="month" name="mes" value="2030-03"></form>');
    expect(queryString(form)).toBe(antes);
    expect(antes).toBe("cliente=recCLIENTE0000001&mes=2030-03");
    expect(submit(form)).toBe(false);
    await pick(sel("Mes a facturar: mes"), "");
    expect(submit(form)).toBe(true);
  });
});

// ── Comprobantes (filtros y edición) ────────────────────────────────────────

const fila = (over: Partial<FilaListado> = {}): FilaListado => ({
  id: "recCOMPROBANTE001",
  clave: "11|2|7|30711111118",
  datos: { fecha: "2026-10-15", tipo: "11 - Factura C", puntoVenta: 2, numeroDesde: 7, denominacionReceptor: "QA Cliente", nroDocReceptor: "30711111118", moneda: "$", impTotal: 1210 },
  importes: { total: 121000, iva: 21000, neto: 100000, impacto: 0, cuentaSocio: 0 },
  contraparte: null,
  mesDevengado: "2026-09-01",
  proyecto: null,
  unidadNegocio: null,
  categoria: null,
  socio: null,
  observaciones: "",
  guardado: { mesDevengado: "2026-09", proyecto: "", unidadNegocio: "", categoria: "", socio: "", observaciones: "" },
  control: "OK",
  ...over,
});
const INITIAL: ListadoInicial = {
  range: { desde: "2026-01-01", hasta: "2026-12-31" },
  filas: [fila()],
  cantidad: 1,
  pagina: 1,
  paginas: 1,
  totales: { total: 121000, iva: 21000, neto: 100000, impacto: 0, cuentaSocio: 0 },
  opciones: { contrapartes: [], contexto: { proyectos: [], unidades: [], categorias: [], socios: [], categoriaVentasPorDefecto: { nombre: "Ingresos por servicios", id: null } } },
};
/** La URL que armaba la lista con el input nativo (mismo `query` de components/horas/api.ts). */
const listaUrl = (f: Partial<Record<"mesDesde" | "mesHasta", string>>) =>
  `/api/admin/comprobantes/ventas${query({ desde: "2026-01-01", hasta: "2026-12-31", mesDesde: "", mesHasta: "", contraparte: "", proyecto: "", categoria: "", control: "", ...f, pagina: "1" })}`;
const renderComprobantes = () =>
  render(
    <ToastProvider>
      <ComprobantesManager kind="ventas" today="2026-11-13" initial={INITIAL} />
    </ToastProvider>,
  );

describe("5–6. Ventas/Compras · filtros Devengado desde / hasta (opcionales)", () => {
  it("Marzo / 2030 → misma URL que con el input nativo; los dos vacíos → sin filtro; a medias → no se aplica", async () => {
    fetchMock.mockImplementation(() => json(200, { ok: true, ...INITIAL }));
    await renderComprobantes();
    await marzo2030("Devengado desde");
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(listaUrl({ mesDesde: "2030-03" }));
    expect(fetchMock.mock.calls.at(-1)![0]).toContain("mesDesde=2030-03");
    await marzo2030("Devengado hasta");
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(listaUrl({ mesDesde: "2030-03", mesHasta: "2030-03" }));
    // A medias: «Completá mes y año.» y no se pide nada nuevo.
    const n = fetchMock.mock.calls.length;
    await pick(sel("Devengado hasta: año"), "");
    expect(container.textContent).toContain("Completá mes y año.");
    expect(fetchMock.mock.calls.length).toBe(n);
    // Los dos vacíos: sin filtro (la URL ya no lleva mesHasta).
    await pick(sel("Devengado hasta: mes"), "");
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(listaUrl({ mesDesde: "2030-03" }));
    expect(fetchMock.mock.calls.at(-1)![0]).not.toContain("mesHasta");
    expect(container.textContent).not.toContain("Completá mes y año.");
  });
});

describe("4. Ventas/Compras · edición, Mes devengado (opcional)", () => {
  const abrir = async () => {
    await renderComprobantes();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Editar 11|2|7|30711111118"]')!.click());
  };
  const guardar = async () => {
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Guardar")!.click());
    await act(async () => {});
  };
  const patchBody = () => {
    const call = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH");
    return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
  };

  it("precarga el guardado; Marzo / 2030 → PATCH con mesDevengado \"2030-03\" (como el input nativo)", async () => {
    await abrir();
    expect([sel("Mes devengado: mes").value, sel("Mes devengado: año").value]).toEqual(["09", "2026"]);
    await marzo2030("Mes devengado");
    fetchMock.mockReturnValueOnce(json(200, { ok: true, id: "recCOMPROBANTE001" })).mockImplementation(() => json(200, { ok: true, ...INITIAL }));
    await guardar();
    expect(patchBody()).toEqual({ mesDevengado: "2030-03", proyecto: "", unidadNegocio: "", categoria: "", socio: undefined, observaciones: "" });
  });

  it("los dos vacíos → \"\" (vuelve al mes de la Fecha, como borrar el input nativo)", async () => {
    await abrir();
    await pick(sel("Mes devengado: mes"), "");
    await pick(sel("Mes devengado: año"), "");
    fetchMock.mockReturnValueOnce(json(200, { ok: true, id: "recCOMPROBANTE001" })).mockImplementation(() => json(200, { ok: true, ...INITIAL }));
    await guardar();
    expect(patchBody().mesDevengado).toBe("");
  });

  it("a medias → «Completá mes y año.» y no se guarda", async () => {
    await abrir();
    await pick(sel("Mes devengado: año"), "");
    await guardar();
    expect(patchBody()).toBeNull();
    expect(container.textContent).toContain("Completá mes y año.");
  });
});

// ── Importación ARCA (vista previa) ─────────────────────────────────────────

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
const CLAVE = "11|2|1|30111111118";

describe("3. Importación ARCA · Mes devengado por fila (vista previa)", () => {
  const L = "Mes devengado, fila 4";
  async function vistaPrevia() {
    await render(<ImportManager kind="ventas" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array([0x50, 0x4b, 3, 4])], "arca.xlsx")], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    fetchMock.mockReturnValueOnce(json(200, { ok: true, ...PREVIEW }));
    await act(async () => [...container.querySelectorAll("button")].find((b) => /Ver vista previa/.test(b.textContent ?? ""))!.click());
    await act(async () => {});
    await pick(sel("Proyecto, fila 4"), "recPROY000000000A");
  }
  const importar = async () => {
    await act(async () => [...container.querySelectorAll("button")].find((b) => /Importar 1 comprobante/.test(b.textContent ?? ""))!.click());
    await act(async () => {});
  };
  const ediciones = () => {
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/admin/importar/ventas/confirmar");
    return call ? JSON.parse(String(((call[1] as RequestInit).body as FormData).get("ediciones"))) : null;
  };

  it("precargado con el mes de la Fecha; Marzo / 2030 → edición \"2030-03\" (como el input nativo)", async () => {
    await vistaPrevia();
    expect([sel(`${L}: mes`).value, sel(`${L}: año`).value]).toEqual(["10", "2026"]);
    await marzo2030(L);
    fetchMock.mockReturnValueOnce(json(200, { ok: true, importadas: 1, omitidas: { yaImportadas: 0, duplicadasEnArchivo: 0, enParalelo: 0 }, conError: [], proveedoresCreados: [] }));
    await importar();
    expect(ediciones()).toEqual({ [CLAVE]: { proyecto: "recPROY000000000A", mesDevengado: "2030-03" } });
  });

  it("los dos vacíos → \"\" (como borrar el input nativo; sin tocarlo no hay edición: test existente)", async () => {
    await vistaPrevia();
    await pick(sel(`${L}: mes`), "");
    await pick(sel(`${L}: año`), "");
    fetchMock.mockReturnValueOnce(json(200, { ok: true, importadas: 1, omitidas: { yaImportadas: 0, duplicadasEnArchivo: 0, enParalelo: 0 }, conError: [], proveedoresCreados: [] }));
    await importar();
    expect(ediciones()).toEqual({ [CLAVE]: { proyecto: "recPROY000000000A", mesDevengado: "" } });
  });

  it("a medias → «Completá mes y año.» en la fila y no se confirma", async () => {
    await vistaPrevia();
    await pick(sel(`${L}: año`), "");
    expect(container.textContent).toContain("Completá mes y año.");
    await importar();
    expect(ediciones()).toBeNull();
    expect(container.textContent).toContain("Completá mes y año en las filas marcadas.");
  });
});
