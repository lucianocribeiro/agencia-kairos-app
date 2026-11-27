// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FacturaEstado } from "@/lib/factura/factura";

const { FacturaArca } = await import("./factura-arca");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** CC-F5-21: la sección «Factura ARCA» manda el TC como dato (nunca importes) y lo usa al recargar. */
let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

const estado = (over: Partial<FacturaEstado> = {}): FacturaEstado => ({
  ambiente: "Homologación",
  configurada: true,
  elegible: true,
  motivos: [],
  hoy: "2026-11-19",
  importes: { neto: 7401235, iva: 1554259, total: 8955494 },
  tipoCambio: 1050.25,
  conversion: { subtotalArs: 225927, subtotalUsd: 6832, netoArsDesdeUsd: 7175308 },
  proformaTotales: [],
  difiere: false,
  alicuota: 0.21,
  detalleSugerido: "Equivalente a USD 68,32 a TC 1.050,25",
  comprobantes: [],
  ...over,
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/emitir") ? { ok: true, id: "recX", estado: "Autorizada", mensaje: null } : estado()), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  window.scrollTo = () => {};
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function abrirYEmitir(tipoCambio: string | null, initial: FacturaEstado) {
  await act(async () => root.render(<FacturaArca cliente={{ id: "recCLIENTE1000000", nombre: "QA" }} mes="2026-10" mesLabel="10/2026" initial={initial} tipoCambio={tipoCambio} />));
  const check = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => check.click());
  const fecha = container.querySelector<HTMLInputElement>('input[type="date"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(fecha, "2026-12-19");
    fecha.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const abierto = container.textContent ?? "";
  const detalle = [...container.querySelectorAll<HTMLInputElement>("input")].find((i) => i.type !== "checkbox" && i.type !== "date")!.value;
  const boton = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Emitir factura"))!;
  await act(async () => boton.click());
  const confirmar = [...document.querySelectorAll("button")].filter((b) => b.textContent?.includes("Emitir factura")).at(-1)!;
  await act(async () => confirmar.click());
  return { abierto, detalle };
}

describe("FacturaArca · tipo de cambio", () => {
  it("con TC: muestra el desglose, precarga el detalle, manda «tipoCambio» (texto) sin importes y recarga con ?tc=", async () => {
    const { abierto, detalle } = await abrirYEmitir("1.050,25", estado());
    expect(detalle).toBe("Equivalente a USD 68,32 a TC 1.050,25");
    expect(abierto).toContain("Incluye USD 68,32 a TC 1.050,25 = $ 71.753,08 y $ 2.259,27 en pesos (neto).");
    const emit = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/admin/facturas/emitir"))!;
    const body = JSON.parse(String((emit[1] as RequestInit).body));
    expect(body).toEqual({ cliente: "recCLIENTE1000000", mes: "2026-10", vencimientoPago: "2026-12-19", detalle: "Equivalente a USD 68,32 a TC 1.050,25", tipoCambio: "1.050,25" });
    const reload = fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith("/api/admin/facturas?"))!;
    expect(reload).toBe("/api/admin/facturas?cliente=recCLIENTE1000000&mes=2026-10&tc=1.050%2C25");
  });

  it("sin TC: el body no lleva «tipoCambio» y la recarga no lleva ?tc=", async () => {
    const { abierto } = await abrirYEmitir(null, estado({ tipoCambio: null, conversion: null, detalleSugerido: "Servicios 10/2026: QA - Web" }));
    expect(abierto).not.toContain("Incluye USD");
    const emit = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/admin/facturas/emitir"))!;
    expect(Object.keys(JSON.parse(String((emit[1] as RequestInit).body))).sort()).toEqual(["cliente", "detalle", "mes", "vencimientoPago"]);
    expect(fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith("/api/admin/facturas?"))).toBe("/api/admin/facturas?cliente=recCLIENTE1000000&mes=2026-10");
  });
});
