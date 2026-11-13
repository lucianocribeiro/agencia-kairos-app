// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AbmData } from "@/lib/abm/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { MaestroManager } = await import("./maestro-manager");
const { ToastProvider } = await import("@/components/ui");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cliente = (id: string, nombre: string, sigla: string, estado: string) => ({
  id,
  values: { nombre, sigla, estado, cuit: null, condicionIva: null, contacto: null, telefono: null, mail: null, observaciones: null },
});
const DATA: AbmData = {
  records: [cliente("recAAAAAAAAAAAAA1", "QA Activo", "QA", "Activo"), cliente("recAAAAAAAAAAAAA2", "QA Inactivo", "QI", "Inactivo")],
  labels: {},
  options: {},
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
        <MaestroManager slug="clientes" data={DATA} />
      </ToastProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const rowsText = () => [...container.querySelectorAll("tbody tr")].map((tr) => tr.textContent ?? "");
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const flush = () => act(async () => {});

describe("Clientes · lista (F2-01)", () => {
  it("por defecto muestra solo Activos; se puede ver Inactivos y Todos", async () => {
    const select = container.querySelector("select")!;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Todos", "Activo", "Inactivo"]);
    expect(select.value).toBe("Activo");
    expect(rowsText().join()).toContain("QA Activo");
    expect(rowsText().join()).not.toContain("QA Inactivo");

    const choose = (value: string) =>
      act(() => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    await choose("Inactivo");
    expect(rowsText()).toHaveLength(1);
    expect(rowsText()[0]).toContain("QA Inactivo");
    await choose("");
    expect(rowsText()).toHaveLength(2);
  });
});

describe("Clientes · borrado (F2-01)", () => {
  const openFirst = () => act(() => (container.querySelector("tbody tr") as HTMLElement).click());

  it("con referencias: muestra el mensaje del servidor y no abre el diálogo ni borra", async () => {
    await openFirst();
    const msg = "No se puede borrar: tiene 2 proyectos y 3 movimientos de Tesorería. Pasalo a Inactivo.";
    fetchMock.mockReturnValueOnce(json(200, { ok: true, blocked: true, message: msg, counts: { proyectos: 2, ventas: 0, tesoreria: 3 } }));
    await act(async () => button("Borrar").click());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/maestros/clientes/recAAAAAAAAAAAAA1/referencias");
    expect(container.textContent).toContain(msg);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("sin referencias: diálogo de confirmación; Cancelar no borra; Sí, borrar → DELETE", async () => {
    await openFirst();
    fetchMock.mockImplementation(() => json(200, { ok: true, blocked: false, message: null, counts: { proyectos: 0, ventas: 0, tesoreria: 0 } }));
    await act(async () => button("Borrar").click());
    await flush();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("¿Borrar QA Activo?");
    expect(document.activeElement?.textContent).toBe("Cancelar");
    await act(async () => button("Cancelar", dialog).click());
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);

    await act(async () => button("Borrar").click());
    await flush();
    fetchMock.mockReturnValueOnce(json(200, { ok: true, id: "recAAAAAAAAAAAAA1" }));
    await act(async () => button("Sí, borrar").click());
    await flush();
    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")!;
    expect(del[0]).toBe("/api/admin/maestros/clientes/recAAAAAAAAAAAAA1");
    expect(refresh).toHaveBeenCalled();
  });
});
