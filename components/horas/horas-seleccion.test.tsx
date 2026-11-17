// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SeleccionData } from "@/lib/horas/seleccion";
import type { HoraAdminDTO, HorasAdminData, HorasOptions } from "@/lib/horas/types";

const { HorasManager } = await import("./horas-manager");
const { ToastProvider } = await import("@/components/ui");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Selección de horas en Admin › Horas (CC-F4-05): reglas de la fila, «seleccionar todo» y filtros. */
const ARS = "recPPPPPPPPPPPPP1";
const USD = "recPPPPPPPPPPPPP2";
const OPTIONS: HorasOptions = {
  usuarios: [{ id: "recUUUUUUUUUUUUU1", nombre: "QA Eva", activo: true }],
  proyectos: [
    { id: ARS, codigo: "QZ - Web", estado: "Activo", cliente: null },
    { id: USD, codigo: "QZ - App", estado: "Activo", cliente: null },
  ],
  clientes: [],
};
const hora = (id: string, fecha: string, proyecto: string, facturable = true): HoraAdminDTO => ({
  id,
  fecha,
  colaborador: { id: "recUUUUUUUUUUUUU1", nombre: "QA Eva" },
  proyecto: { id: proyecto, codigo: proyecto === ARS ? "QZ - Web" : "QZ - App", estado: "Activo" },
  cliente: null,
  tarea: "QA",
  desde: "09:00",
  hasta: "10:00",
  horas: 1,
  facturable,
  mesAFacturar: `${fecha.slice(0, 7)}-01`,
  cargadoPor: { id: "recUUUUUUUUUUUUU1", nombre: "QA Eva" },
  estadoFacturacion: "Pendiente",
});
const RECORDS = [
  hora("recHHHHHHHHHHHHH1", "2030-03-01", ARS),
  hora("recHHHHHHHHHHHHH2", "2030-03-02", ARS),
  hora("recHHHHHHHHHHHHH3", "2030-03-03", ARS, false),
  hora("recHHHHHHHHHHHHH4", "2030-03-04", USD),
];
const INITIAL: HorasAdminData = { range: { desde: "2030-03-01", hasta: "2030-03-31" }, records: RECORDS, total: 4 };
const RESUMEN: SeleccionData = {
  proyecto: { id: ARS, codigo: "QZ - Web" },
  valorHora: 1234.57,
  moneda: "ARS",
  registros: 2,
  horas: 2,
  neto: 246914,
  iva: 51852,
  total: 298766,
  desde: "2030-03-01",
  hasta: "2030-03-02",
  detalle: [],
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let listFor: (url: string) => HoraAdminDTO[];
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  listFor = () => RECORDS;
  fetchMock = vi.fn((url: string) => {
    const body =
      url === "/api/admin/horas/seleccion"
        ? { ok: true, ...RESUMEN }
        : url === "/api/admin/horas/seleccion/estado"
          ? { ok: true, actualizadas: 2, estado: "Facturada" }
          : { range: INITIAL.range, records: listFor(url), total: 0 };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  });
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

const fila = (fecha: string) => container.querySelector<HTMLInputElement>(`input[aria-label^="Seleccionar registro del ${fecha}"]`)!;
const todos = () => container.querySelector<HTMLInputElement>('input[aria-label="Seleccionar todas las horas facturables de la lista"]')!;
const click = (el: HTMLElement) => act(async () => el.click());
const panel = () => container.querySelector('[data-testid="seleccion-panel"]');
const selCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/api/admin/horas/seleccion");
function filtrarProyecto(id: string) {
  return act(async () => {
    const s = [...container.querySelectorAll<HTMLSelectElement>("select")].find((x) => [...x.options].some((o) => o.value === ARS) && !x.closest("form"))!;
    s.value = id;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Horas (Admin) · selección (CC-F4-05)", () => {
  it("las no facturables tienen el checkbox deshabilitado", () => {
    expect(fila("03/03/2030").disabled).toBe(true);
    expect(fila("03/03/2030").title).toBe("Sólo se pueden seleccionar horas facturables.");
    expect(fila("01/03/2030").disabled).toBe(false);
    expect(fila("04/03/2030").disabled).toBe(false);
  });

  it("después de la primera, las de otro proyecto quedan deshabilitadas hasta vaciar la selección", async () => {
    await click(fila("01/03/2030"));
    expect(fila("04/03/2030").disabled).toBe(true);
    expect(fila("04/03/2030").title).toBe("Sólo podés seleccionar horas de un mismo proyecto.");
    expect(fila("02/03/2030").disabled).toBe(false);
    expect(container.textContent).toContain("Sólo podés seleccionar horas de un mismo proyecto.");
    await click(fila("02/03/2030"));
    // El servidor recibe solo IDs.
    expect(JSON.parse(selCalls().at(-1)![1].body)).toEqual({ ids: ["recHHHHHHHHHHHHH1", "recHHHHHHHHHHHHH2"] });
    // Panel con Proyecto, Valor hora, Moneda, Registros, Horas, Neto, IVA, Total.
    const text = panel()!.textContent!;
    for (const s of ["QZ - Web", "1.234,57", "ARS", "Registros2", "2,00", "2.469,14", "518,52", "2.987,66", "Descargar Excel", "Limpiar selección"]) expect(text).toContain(s);
    await click(fila("01/03/2030"));
    await click(fila("02/03/2030"));
    expect(panel()).toBeNull();
    expect(fila("04/03/2030").disabled).toBe(false);
  });

  it("«Limpiar selección» vacía todo", async () => {
    await click(fila("01/03/2030"));
    await click([...panel()!.querySelectorAll("button")].find((b) => b.textContent === "Limpiar selección")!);
    expect(panel()).toBeNull();
    expect(fila("01/03/2030").checked).toBe(false);
  });

  it("«seleccionar todo» solo con la lista filtrada a un proyecto; tilda todas las facturables visibles", async () => {
    expect(todos().disabled).toBe(true);
    listFor = (url) => (url.includes(`proyecto=${ARS}`) ? RECORDS.filter((r) => r.proyecto!.id === ARS) : RECORDS);
    await filtrarProyecto(ARS);
    expect(todos().disabled).toBe(false);
    await click(todos());
    expect(fila("01/03/2030").checked).toBe(true);
    expect(fila("02/03/2030").checked).toBe(true);
    expect(fila("03/03/2030").checked).toBe(false); // no facturable
    expect(JSON.parse(selCalls().at(-1)![1].body)).toEqual({ ids: ["recHHHHHHHHHHHHH1", "recHHHHHHHHHHHHH2"] });
    await click(todos());
    expect(fila("01/03/2030").checked).toBe(false);
  });

  it("cambiar un filtro limpia la selección", async () => {
    await click(fila("01/03/2030"));
    expect(panel()).not.toBeNull();
    await filtrarProyecto(USD);
    expect(panel()).toBeNull();
    expect(fila("01/03/2030").checked).toBe(false);
  });
});

describe("Horas (Admin) · Estado de facturación (CC-F4-08)", () => {
  const boton = (t: string, root: ParentNode = container) => [...root.querySelectorAll("button")].find((b) => b.textContent === t)!;
  const dialog = () => document.querySelector('[role="alertdialog"]');

  it("columna Estado en la lista y filtro Todos / Pendiente / Facturada / Pagada", () => {
    expect([...container.querySelectorAll("thead th")].map((th) => th.textContent)).toContain("Estado");
    expect(container.querySelector("tbody tr")!.textContent).toContain("Pendiente");
    const filtro = [...container.querySelectorAll<HTMLSelectElement>("select")].find((x) => [...x.options].some((o) => o.value === "Pagada") && !x.closest("form"))!;
    expect([...filtro.options].map((o) => o.textContent)).toEqual(["Todos", "Pendiente", "Facturada", "Pagada"]);
  });

  it("los dos botones; diálogo con el texto exacto y confirmar en acento; POST { ids, estado }; toast y la lista se recarga", async () => {
    await click(fila("01/03/2030"));
    await click(fila("02/03/2030"));
    const p = panel()!;
    expect(boton("Marcar como facturadas", p)).toBeDefined();
    expect(boton("Marcar como pagadas", p)).toBeDefined();

    await click(boton("Marcar como pagadas", p));
    expect(dialog()!.querySelector("h2")!.textContent).toBe("¿Marcar 2 horas como pagadas?");
    await click(boton("Cancelar", dialog()!));
    expect(dialog()).toBeNull();

    await click(boton("Marcar como facturadas", p));
    expect(dialog()!.querySelector("h2")!.textContent).toBe("¿Marcar 2 horas como facturadas?");
    const confirmar = boton("Marcar como facturadas", dialog()!);
    expect(confirmar.className).toContain("bg-accent");
    expect(confirmar.className).not.toContain("text-danger");
    const antes = fetchMock.mock.calls.length;
    await click(confirmar);
    await act(async () => {});
    const post = fetchMock.mock.calls.find(([url]) => url === "/api/admin/horas/seleccion/estado")!;
    expect(JSON.parse(post[1].body)).toEqual({ ids: ["recHHHHHHHHHHHHH1", "recHHHHHHHHHHHHH2"], estado: "Facturada" });
    expect(document.body.textContent).toContain("2 horas marcadas como facturadas.");
    // La lista se recarga (GET) y la selección se limpia.
    expect(fetchMock.mock.calls.slice(antes).some(([url]) => String(url).startsWith("/api/admin/horas?"))).toBe(true);
    expect(panel()).toBeNull();
  });
});
