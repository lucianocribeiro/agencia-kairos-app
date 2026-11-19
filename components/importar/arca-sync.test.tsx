// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Preview } from "@/lib/ventas-compras/types";

const { ImportManager, ARCA_UI_MESSAGES, POLL_MS } = await import("./import-manager");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** CUIT sintético válido (dígito verificador correcto) y una clave de prueba. */
const CUIT_LOGIN = "20818181818";
const CLAVE = "Clave-Fiscal-Secreta!9";
const TODAY = "2026-11-19";

const PREVIEW: Preview = {
  tipo: "ventas",
  filas: [
    {
      fila: 1,
      clave: "11|2|1|30111111118",
      estado: "nueva",
      error: null,
      datos: { fecha: "2026-10-15", tipo: "11 - Factura C", puntoVenta: 2, numeroDesde: 1, nroDocReceptor: "30111111118", denominacionReceptor: "QA", moneda: "$", impTotal: 1000 },
      codigo: 11,
      signo: 1,
      tipoComprobanteId: "recTIPO0000000011",
      importes: { total: 100000, iva: 0, otros: 0, neto: 100000 },
      mesFecha: "2026-10-01",
      clientePorCuit: { id: "recCLI0000000000A", nombre: "QA Cliente" },
      proveedor: null,
    },
  ],
  contexto: { proyectos: [], unidades: [], categorias: [{ id: "recCAT00000000000", nombre: "Ingresos por servicios", tipo: "Ingreso", requiereProyecto: false }], socios: [], categoriaVentasPorDefecto: { nombre: "Ingresos por servicios", id: "recCAT00000000000" } },
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
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const button = (text: RegExp) => [...document.querySelectorAll("button")].find((b) => text.test(b.textContent ?? ""))!;
const dialog = () => document.querySelector('[role="alertdialog"]');
const field = (label: string) => {
  const l = [...document.querySelectorAll("label")].find((x) => x.textContent?.trim() === label)!;
  return document.getElementById(l.htmlFor) as HTMLInputElement;
};
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const render = (configurado: boolean, abrir = false) => act(() => root.render(<ImportManager kind="ventas" today={TODAY} arca={{ configurado, abrir }} />));

async function fillAndSubmit() {
  await type(field("Desde"), "2026-10-01");
  await type(field("Hasta"), "2026-10-31");
  await type(field("Usuario ARCA (CUIT)"), CUIT_LOGIN);
  await type(field("Clave fiscal"), CLAVE);
  await act(async () => button(/^Sincronizar$/).click());
  await act(async () => {});
}

describe("Sincronizar con ARCA (UI)", () => {
  it("no configurada: botón deshabilitado con el aviso; sin diálogo", async () => {
    await render(false, true);
    const b = button(new RegExp(`^${ARCA_UI_MESSAGES.titulo}$`));
    expect(b.disabled).toBe(true);
    expect(container.textContent).toContain("La sincronización con ARCA no está configurada.");
    expect(dialog()).toBeNull();
  });

  it("el formulario: clave type=password, autocomplete off, y la nota", async () => {
    await render(true, true);
    expect(dialog()).not.toBeNull();
    expect(field("Clave fiscal").type).toBe("password");
    expect(field("Clave fiscal").autocomplete).toBe("off");
    expect(field("Usuario ARCA (CUIT)").autocomplete).toBe("off");
    expect(dialog()!.textContent).toContain("La clave se usa sólo para esta sincronización y no se guarda.");
  });

  it("error del servidor: el diálogo sigue abierto con el error y las credenciales se borraron", async () => {
    await render(true, true);
    fetchMock.mockReturnValueOnce(json(400, { error: "Usuario [redactado] o clave incorrecta" }));
    await fillAndSubmit();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/arca/ventas/sincronizar");
    expect(JSON.parse(String(init.body))).toEqual({ desde: "2026-10-01", hasta: "2026-10-31", usuario: CUIT_LOGIN, clave: CLAVE });
    expect(dialog()!.textContent).toContain("Usuario [redactado] o clave incorrecta");
    expect(field("Clave fiscal").value).toBe("");
    expect(field("Usuario ARCA (CUIT)").value).toBe("");
    expect(field("Desde").value).toBe("2026-10-01");
  });

  it("falla de red: también se borran", async () => {
    await render(true, true);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await fillAndSubmit();
    expect(field("Clave fiscal").value).toBe("");
    expect(field("Usuario ARCA (CUIT)").value).toBe("");
  });

  it("validación previa: CUIT inválida no llama al servidor", async () => {
    await render(true, true);
    await type(field("Usuario ARCA (CUIT)"), "20-12345678-0");
    await type(field("Clave fiscal"), CLAVE);
    await act(async () => button(/^Sincronizar$/).click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dialog()!.textContent).toContain("El usuario de ARCA tiene que ser una CUIT válida.");
  });

  it("éxito: credenciales borradas, consulta cada 5 s, vista previa con «comprobante N» y confirma con el payload", async () => {
    vi.useFakeTimers();
    await render(true, true);
    fetchMock.mockReturnValueOnce(json(200, { ok: true, syncId: "rec00000000000001" }));
    await fillAndSubmit();
    expect(dialog()).toBeNull();
    expect(container.textContent).toContain(ARCA_UI_MESSAGES.consultando);

    // Reabrir el diálogo no muestra nada de lo que se escribió.
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain(CLAVE);

    fetchMock.mockReturnValueOnce(json(200, { ok: true, estado: "en_proceso" }));
    await act(async () => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/admin/arca/sincronizaciones/rec00000000000001");
    fetchMock.mockReturnValueOnce(json(200, { ok: true, estado: "lista", preview: PREVIEW, payload: "firmado.x" }));
    await act(async () => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(container.textContent).not.toContain(ARCA_UI_MESSAGES.consultando);
    expect(container.querySelector('select[aria-label="Unidad de negocio, comprobante 1"]')).not.toBeNull();
    expect(container.textContent).toContain("N.º");

    fetchMock.mockReturnValueOnce(json(200, { ok: true, importadas: 1, omitidas: { yaImportadas: 0, duplicadasEnArchivo: 0, enParalelo: 0 }, conError: [], proveedoresCreados: [] }));
    await act(async () => button(/Importar 1 comprobante/).click());
    await act(async () => {});
    const [url, init] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(url).toBe("/api/admin/arca/ventas/confirmar");
    expect(JSON.parse(String(init.body))).toEqual({ syncId: "rec00000000000001", payload: "firmado.x", ediciones: {} });
    expect(container.textContent).toContain("Importación terminada");
    // Ningún pedido llevó la clave salvo el de inicio.
    expect(fetchMock.mock.calls.filter(([, i]) => String((i as RequestInit | undefined)?.body ?? "").includes(CLAVE))).toHaveLength(1);
  });

  it("«Dejar de consultar» corta la consulta (el log vence solo)", async () => {
    vi.useFakeTimers();
    await render(true, true);
    fetchMock.mockReturnValueOnce(json(200, { ok: true, syncId: "rec00000000000001" }));
    await fillAndSubmit();
    await act(async () => button(new RegExp(ARCA_UI_MESSAGES.dejarDeConsultar)).click());
    await act(async () => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(ARCA_UI_MESSAGES.cancelado);
  });

  it("error al consultar (400) → se muestra y deja de consultar", async () => {
    vi.useFakeTimers();
    await render(true, true);
    fetchMock.mockReturnValueOnce(json(200, { ok: true, syncId: "rec00000000000001" }));
    await fillAndSubmit();
    fetchMock.mockReturnValueOnce(json(400, { error: "Faltan columnas en la respuesta de ARCA: «Nro. Doc. Emisor» · Columnas recibidas: IVA" }));
    await act(async () => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(container.textContent).toContain("Faltan columnas en la respuesta de ARCA");
    await act(async () => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
