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
    // Default de ConfirmDialog sin cambios (CC-F4-06-FIX): confirmar secundario en rojo.
    expect(button("Sí, borrar", dialog).className).toContain("text-danger");
    expect(button("Sí, borrar", dialog).className).not.toContain("bg-accent");
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

describe("Tipos de operación · tipo de transferencia protegido (CC-F2-04 v2)", () => {
  it("el formulario muestra bloqueados nombre, movimiento, suma y es de socio, y no ofrece borrar", async () => {
    act(() => root.unmount());
    root = createRoot(container);
    const tipo = (id: string, nombre: string) => ({
      id,
      values: { nombre, movimiento: "Ambos", sumaAResultados: false, categoriaPorDefecto: [], pideClienteProveedor: false, esDeSocio: false },
    });
    const data: AbmData = { records: [tipo("recTIPO0000000001", "Transferencia entre cuentas propias"), tipo("recTIPO0000000002", "Otro")], labels: {}, options: {} };
    act(() =>
      root.render(
        <ToastProvider>
          <MaestroManager slug="tipos-de-operacion" data={data} />
        </ToastProvider>,
      ),
    );
    const openRow = (name: string) => act(() => (container.querySelector(`button[aria-label="Editar ${name}"]`) as HTMLButtonElement).click());
    await openRow("Transferencia entre cuentas propias");
    expect(container.textContent).toContain("lo usa Tesorería para las transferencias");
    const disabled = [...container.querySelectorAll("form input, form select")].filter((el) => (el as HTMLInputElement).disabled).length;
    expect(disabled).toBe(4);
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Borrar")).toBe(false);
    await act(async () => ([...container.querySelectorAll("button")].find((b) => b.textContent === "Cancelar") as HTMLButtonElement).click());
    await openRow("Otro");
    expect([...container.querySelectorAll("form input, form select")].filter((el) => (el as HTMLInputElement).disabled)).toHaveLength(0);
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Borrar")).toBe(true);
  });
});

describe("Tipos de operación · tipos de los reportes protegidos (CC-F4-02)", () => {
  it("«Retiro de socio»: Nombre, Movimiento y Es de socio bloqueados con el aviso; los otros 3 editables; sin Borrar", async () => {
    act(() => root.unmount());
    root = createRoot(container);
    const values = { nombre: "Retiro de socio", movimiento: "Pago", sumaAResultados: false, categoriaPorDefecto: [], pideClienteProveedor: false, esDeSocio: true };
    const data: AbmData = { records: [{ id: "recTIPO0000000003", values }], labels: {}, options: {} };
    act(() =>
      root.render(
        <ToastProvider>
          <MaestroManager slug="tipos-de-operacion" data={data} />
        </ToastProvider>,
      ),
    );
    await act(async () => (container.querySelector('button[aria-label="Editar Retiro de socio"]') as HTMLButtonElement).click());
    expect(container.textContent).toContain("Este tipo de operación lo usan los reportes: no se puede renombrar ni borrar, ni cambiar su Movimiento ni Es de socio.");
    const byLabel = (label: string) => {
      const l = [...container.querySelectorAll("form label")].find((x) => x.textContent?.replace("*", "").trim() === label) as HTMLLabelElement;
      return (l.htmlFor ? container.querySelector(`#${CSS.escape(l.htmlFor)}`) : l.querySelector("input,select")) as HTMLInputElement;
    };
    for (const label of ["Nombre", "Movimiento", "Es de socio"]) expect(byLabel(label).disabled, label).toBe(true);
    for (const label of ["Suma a resultados", "Categoría por defecto", "Pide cliente/proveedor"]) expect(byLabel(label).disabled, label).toBe(false);
    expect([...container.querySelectorAll("form input, form select")].filter((el) => (el as HTMLInputElement).disabled)).toHaveLength(3);
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Borrar")).toBe(false);
  });
});

describe("Cuentas · Moneda bloqueada con movimientos (CC-F2-04 v4)", () => {
  it("con movimientos la Moneda se ve bloqueada; sin movimientos, editable", async () => {
    act(() => root.unmount());
    root = createRoot(container);
    const cuenta = (id: string, nombre: string, referenceCount: number) => ({
      id,
      referenceCount,
      values: { nombre, moneda: "ARS", banco: null, cbu: null, saldoInicial: null, fechaSaldoInicial: null },
    });
    const data: AbmData = { records: [cuenta("recCUENTA00000001", "Con movimientos", 3), cuenta("recCUENTA00000002", "Sin movimientos", 0)], labels: {}, options: {} };
    act(() =>
      root.render(
        <ToastProvider>
          <MaestroManager slug="cuentas" data={data} />
        </ToastProvider>,
      ),
    );
    const open = (name: string) => act(() => (container.querySelector(`button[aria-label="Editar ${name}"]`) as HTMLButtonElement).click());
    const monedaDisabled = () => [...container.querySelectorAll("form select")].some((el) => (el as HTMLSelectElement).disabled);
    await open("Con movimientos");
    expect(container.textContent).toContain("no se puede cambiar la moneda");
    expect(monedaDisabled()).toBe(true);
    expect((container.querySelector("form input") as HTMLInputElement).disabled).toBe(false); // nombre sí
    await act(async () => ([...container.querySelectorAll("button")].find((b) => b.textContent === "Cancelar") as HTMLButtonElement).click());
    await open("Sin movimientos");
    expect(monedaDisabled()).toBe(false);
  });
});

describe("Clientes · Traer datos de ARCA (F5-05 · CC-F5-18)", () => {
  const CUIT_OK = "30-71234567-1";
  const render = (padron?: { configured: boolean; motivo: string | null }, records = DATA.records) => {
    act(() => root.unmount());
    root = createRoot(container);
    act(() =>
      root.render(
        <ToastProvider>
          <MaestroManager slug="clientes" data={{ ...DATA, records }} padron={padron} />
        </ToastProvider>,
      ),
    );
  };
  const byLabel = (label: string) => {
    const l = [...container.querySelectorAll("form label")].find((x) => x.textContent?.replace("*", "").trim() === label) as HTMLLabelElement;
    return (l.htmlFor ? container.querySelector(`#${CSS.escape(l.htmlFor)}`) : l.querySelector("input,select")) as HTMLInputElement | HTMLSelectElement;
  };
  const type = (el: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const arcaButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Traer datos de ARCA") || b.textContent?.includes("Consultando ARCA"))!;
  const conCliente = [
    {
      id: "recAAAAAAAAAAAAA1",
      values: { nombre: "QA Activo", sigla: "QA", estado: "Activo", cuit: "30712345671", condicionIva: "Exento", razonSocial: "Vieja SA", domicilioComercial: "", contacto: null, telefono: null, mail: null, observaciones: null },
    },
  ];

  it("sin configurar: el botón está deshabilitado con el motivo; sin la prop (Leads u otro) no hay botón", async () => {
    render({ configured: false, motivo: "Cargá una CUIT válida en Parámetros «CUIT»." });
    await act(async () => button("Nuevo cliente").click());
    expect(arcaButton().disabled).toBe(true);
    expect(container.textContent).toContain("Cargá una CUIT válida en Parámetros «CUIT».");
    render(undefined);
    await act(async () => button("Nuevo cliente").click());
    expect(arcaButton()).toBeUndefined();
  });

  it("habilitado solo con una CUIT válida", async () => {
    render({ configured: true, motivo: null });
    await act(async () => button("Nuevo cliente").click());
    expect(arcaButton().disabled).toBe(true);
    expect(container.textContent).toContain("Ingresá una CUIT válida para consultar ARCA.");
    await type(byLabel("CUIT") as HTMLInputElement, "30-71234567-0");
    expect(arcaButton().disabled).toBe(true);
    await type(byLabel("CUIT") as HTMLInputElement, CUIT_OK);
    expect(arcaButton().disabled).toBe(false);
    expect(container.textContent).not.toContain("Ingresá una CUIT válida para consultar ARCA.");
  });

  it("completa los tres campos con «Antes», muestra avisos, deja editar y no guarda nada hasta Guardar", async () => {
    render({ configured: true, motivo: null }, conCliente);
    await act(async () => (container.querySelector("tbody tr") as HTMLElement).click());
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    await act(async () => arcaButton().click());
    expect(arcaButton().textContent).toContain("Consultando ARCA…");
    expect(arcaButton().disabled).toBe(true);
    expect(button("Guardar").disabled).toBe(true);
    await act(async () => resolve(new Response(JSON.stringify({ ok: true, razonSocial: "QA CLIENTE SA", domicilio: "AV QA 742 - CABA", condicionIva: "Responsable Inscripto", avisos: ["La CUIT figura en ARCA con estado «INACTIVO»."] }), { status: 200 })));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/clientes/padron");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ cuit: "30-71234567-1" });
    expect((byLabel("Razón social") as HTMLInputElement).value).toBe("QA CLIENTE SA");
    expect((byLabel("Domicilio comercial") as HTMLInputElement).value).toBe("AV QA 742 - CABA");
    expect(byLabel("Condición IVA").value).toBe("Responsable Inscripto");
    const antes = Object.fromEntries([...container.querySelectorAll("[data-antes]")].map((p) => [p.getAttribute("data-antes"), p.textContent]));
    expect(antes).toEqual({ razonSocial: "Antes: Vieja SA", domicilioComercial: "Antes: —", condicionIva: "Antes: Exento" });
    expect(container.textContent).toContain("La CUIT figura en ARCA con estado «INACTIVO».");
    expect(refresh).not.toHaveBeenCalled();
    expect(byLabel("Razón social").disabled).toBe(false);
    await type(byLabel("Razón social") as HTMLInputElement, "QA Cliente S.A.");
    expect((byLabel("Razón social") as HTMLInputElement).value).toBe("QA Cliente S.A.");

    fetchMock.mockReturnValueOnce(json(200, { ok: true, id: "recAAAAAAAAAAAAA1" }));
    await act(async () => button("Guardar").click());
    await flush();
    const patch = fetchMock.mock.calls[1];
    expect(patch[0]).toBe("/api/admin/maestros/clientes/recAAAAAAAAAAAAA1");
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toMatchObject({ razonSocial: "QA Cliente S.A.", domicilioComercial: "AV QA 742 - CABA", condicionIva: "Responsable Inscripto" });
  });

  it("condición IVA null no pisa el valor; un error se muestra; Cancelar descarta todo", async () => {
    render({ configured: true, motivo: null }, conCliente);
    await act(async () => (container.querySelector("tbody tr") as HTMLElement).click());
    fetchMock.mockReturnValueOnce(json(200, { ok: true, razonSocial: "Vieja SA", domicilio: null, condicionIva: null, avisos: ["No pudimos determinar la condición frente al IVA; completala a mano."] }));
    await act(async () => arcaButton().click());
    await flush();
    expect(byLabel("Condición IVA").value).toBe("Exento");
    expect(container.querySelectorAll("[data-antes]")).toHaveLength(0);
    expect(container.textContent).toContain("ARCA no devolvió datos nuevos para este cliente.");
    expect(container.textContent).toContain("completala a mano");
    fetchMock.mockReturnValueOnce(json(404, { error: "La CUIT no figura en el padrón de ARCA." }));
    await act(async () => arcaButton().click());
    await flush();
    expect(container.textContent).toContain("La CUIT no figura en el padrón de ARCA.");
    expect(fetchMock.mock.calls.every((c) => c[0] === "/api/admin/clientes/padron")).toBe(true);
    await act(async () => button("Cancelar").click());
    expect(container.querySelector("form")).toBeNull();
  });
});
