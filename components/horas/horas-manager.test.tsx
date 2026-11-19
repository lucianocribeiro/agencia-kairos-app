// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HoraAdminDTO, HorasAdminData, HorasOptions } from "@/lib/horas/types";

const { HorasManager } = await import("./horas-manager");
const { ToastProvider } = await import("@/components/ui");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS: HorasOptions = {
  usuarios: [{ id: "recUUUUUUUUUUUUU1", nombre: "QA Eva", activo: true }],
  proyectos: [{ id: "recPPPPPPPPPPPPP1", codigo: "QZ - Uno", estado: "Activo", cliente: null }],
  clientes: [],
};
const hora = (id: string, fecha: string, mesAFacturar: string | null): HoraAdminDTO => ({
  id,
  fecha,
  colaborador: { id: "recUUUUUUUUUUUUU1", nombre: "QA Eva" },
  proyecto: { id: "recPPPPPPPPPPPPP1", codigo: "QZ - Uno", estado: "Activo" },
  cliente: null,
  tarea: "QA",
  desde: "09:00",
  hasta: "10:00",
  horas: 1,
  facturable: true,
  mesAFacturar,
  cargadoPor: { id: "recUUUUUUUUUUUUU1", nombre: "QA Eva" },
  estadoFacturacion: "Pendiente",
});
const INITIAL: HorasAdminData = {
  range: { desde: "2030-03-01", hasta: "2030-03-31" },
  records: [hora("recHHHHHHHHHHHHH1", "2030-03-20", "2030-04-01"), hora("recHHHHHHHHHHHHH2", "2030-03-10", null)],
  total: 2,
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // POST → 201; GET (recarga de la lista) → la lista inicial.
  fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(init?.method === "POST" ? { id: "recNEW" } : INITIAL), { status: init?.method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  window.scrollTo = () => {};
  act(() =>
    root.render(
      <ToastProvider>
        <HorasManager today="2030-03-15" options={OPTIONS} initial={INITIAL} />
      </ToastProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const fecha = () => container.querySelector<HTMLInputElement>('form input[type="date"]')!;
const mesSel = () => container.querySelector<HTMLSelectElement>('select[aria-label="Mes a facturar: mes"]')!;
const anioSel = () => container.querySelector<HTMLSelectElement>('select[aria-label="Mes a facturar: año"]')!;
/** Lo que muestran los dos selects: «Marzo / 2030». */
const mes = () => `${mesSel().selectedOptions[0]?.textContent} / ${anioSel().selectedOptions[0]?.textContent}`;
function choose(s: HTMLSelectElement, value: string) {
  act(() => {
    s.value = value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
/** Cambia un input controlado como lo haría el usuario (React escucha "input"). */
function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const editar = (fechaLabel: string) => act(() => container.querySelector<HTMLButtonElement>(`button[aria-label^="Editar registro del ${fechaLabel}"]`)!.click());

describe("Horas (Admin) · formulario sin Estado de facturación (CC-F4-10 / F4-12)", () => {
  it("alta y edición: no hay campo «Estado de facturación»", () => {
    act(() => button("Nuevo registro").click());
    const form = container.querySelector("form")!;
    expect(form.textContent).not.toMatch(/Estado de facturación/i);
    expect([...form.querySelectorAll("select option")].some((o) => ["Facturada", "Pagada"].includes(o.textContent ?? ""))).toBe(false);
    act(() => button("Cancelar").click());
    editar("20/03/2030");
    const edit = container.querySelector("form")!;
    expect(edit.textContent).not.toMatch(/Estado de facturación/i);
    expect([...edit.querySelectorAll("select option")].some((o) => ["Facturada", "Pagada"].includes(o.textContent ?? ""))).toBe(false);
  });
});

describe("Horas (Admin) · Mes a facturar en el formulario (CC-F4-03)", () => {
  it("alta: precargado con el mes de la Fecha, obligatorio, y sigue a la Fecha mientras no se cambie a mano", () => {
    act(() => button("Nuevo registro").click());
    expect(fecha().value).toBe("2030-03-15");
    expect(mes()).toBe("Marzo / 2030");
    expect(container.querySelector('input[type="month"]')).toBeNull();
    expect([...mesSel().options].map((o) => o.textContent)).toEqual(["Mes", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]);
    const anios = [...anioSel().options].map((o) => o.textContent);
    expect([anios[0], anios[1], anios.at(-1), anios.length]).toEqual(["Año", "2000", "2099", 101]);
    expect(container.textContent).toContain("Por defecto, el mes de la Fecha.");
    expect(container.textContent).not.toContain("Opcional.");
    type(fecha(), "2030-05-02");
    expect(mes()).toBe("Mayo / 2030");
    type(fecha(), "2031-01-20");
    expect(mes()).toBe("Enero / 2031");
  });

  it("alta: cambiar a mano el mes deja de seguir a la Fecha", () => {
    act(() => button("Nuevo registro").click());
    choose(mesSel(), "07");
    type(fecha(), "2030-09-10");
    expect(mes()).toBe("Julio / 2030");
  });

  it("alta: cambiar a mano el año deja de seguir a la Fecha", () => {
    act(() => button("Nuevo registro").click());
    choose(anioSel(), "2031");
    type(fecha(), "2030-09-10");
    expect(mes()).toBe("Marzo / 2031");
  });

  it("alta: lo que se manda es el mes precargado", async () => {
    act(() => button("Nuevo registro").click());
    const select = (i: number, value: string) =>
      act(() => {
        const s = container.querySelectorAll("form select")[i] as HTMLSelectElement;
        s.value = value;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      });
    select(0, "recUUUUUUUUUUUUU1");
    select(1, "recPPPPPPPPPPPPP1");
    type(fecha(), "2030-06-30");
    act(() => {
      const t = container.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(t, "QA tarea");
      t.dispatchEvent(new Event("input", { bubbles: true }));
    });
    type(container.querySelectorAll<HTMLInputElement>('form input[type="time"]')[0], "09:00");
    type(container.querySelectorAll<HTMLInputElement>('form input[type="time"]')[1], "10:00");
    await act(async () => button("Guardar").click());
    expect(fetchMock).toHaveBeenCalledTimes(2); // POST + recarga de la lista
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/horas");
    expect(JSON.parse(init.body)).toMatchObject({ fecha: "2030-06-30", mesAFacturar: "2030-06" });
    // CC-F4-10 (F4-12): el alta no manda Estado de facturación.
    expect(JSON.parse(init.body)).not.toHaveProperty("estadoFacturacion");
  });

  it.each([
    ["el mes", () => mesSel()],
    ["el año", () => anioSel()],
  ])("alta con %s vaciado a mano: no se manda y muestra «Elegí el mes a facturar.»", async (_l, sel) => {
    act(() => button("Nuevo registro").click());
    choose(sel(), "");
    type(fecha(), "2030-09-10"); // ya no sigue a la Fecha: queda vacío
    expect(sel().value).toBe("");
    await act(async () => button("Guardar").click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Elegí el mes a facturar.");
  });

  it("edición: muestra el guardado y cambiar la Fecha no lo cambia", () => {
    editar("20/03/2030");
    expect(mes()).toBe("Abril / 2030");
    type(fecha(), "2030-06-01");
    expect(mes()).toBe("Abril / 2030");
  });

  it("edición de un registro legacy vacío: precargado con el mes de la Fecha", () => {
    editar("10/03/2030");
    expect(mes()).toBe("Marzo / 2030");
    type(fecha(), "2030-08-01");
    expect(mes()).toBe("Marzo / 2030");
  });
});
