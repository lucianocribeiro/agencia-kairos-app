// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LeadDTO } from "@/lib/leads/leads";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { LeadsManager } = await import("./leads-manager");
const { ToastProvider } = await import("@/components/ui");
const { LEAD_MESSAGES } = await import("@/lib/leads/leads");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Leads (CC-F4-06): filas convertidas en gris y de solo lectura, diálogos y opciones de Tipo. */
const vacio = { status: null, proyecto: null, contacto: null, telefono: null, mail: null, origen: null, referidoPor: null, comentarios: null, ventas: null, cobranzas: null, ventasSrl: null, cobranzasSrl: null };
const LEADS: LeadDTO[] = [
  { id: "recLLLLLLLLLLLLL1", values: { ...vacio, nombre: "QA Abierto", tipo: "Lead", origen: "Referidos", telefono: "+54 11 1" }, cliente: null, convertido: false },
  { id: "recLLLLLLLLLLLLL2", values: { ...vacio, nombre: "QA Convertido", tipo: "Cliente", origen: "F&F" }, cliente: { id: "recCCCCCCCCCCCCC1", nombre: "QA Convertido SA" }, convertido: true },
  { id: "recLLLLLLLLLLLLL3", values: { ...vacio, nombre: "QA Frío", tipo: "Frío", status: "Concluido" }, cliente: null, convertido: false },
];

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, id: "recLLLLLLLLLLLLL1" }), { status: 200, headers: { "content-type": "application/json" } })));
  vi.stubGlobal("fetch", fetchMock);
  window.scrollTo = () => {};
  refresh.mockClear();
  act(() =>
    root.render(
      <ToastProvider>
        <LeadsManager leads={LEADS} />
      </ToastProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const fila = (nombre: string) => [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent!.includes(nombre)) as HTMLTableRowElement;
const boton = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const dialog = () => container.querySelector('[role="alertdialog"]');
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const dialogButton = (text: string) => [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === text)!;
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function respond(status: number, body: object) {
  fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
}

describe("Leads · lista (CC-F4-06)", () => {
  it("columnas en orden", () => {
    const heads = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads).toEqual(["Nombre", "Tipo", "Status", "Contacto", "Teléfono", "Mail", "Origen", "Referido por", "Acciones"]);
  });

  it("el convertido se ve en gris, con link al cliente en Maestros › Clientes, y solo ofrece Eliminar", async () => {
    const tr = fila("QA Convertido");
    expect(tr.dataset.convertido).toBe("true");
    expect(tr.className).toContain("text-muted");
    const link = tr.querySelector<HTMLAnchorElement>("a")!;
    expect(link.getAttribute("href")).toBe("/maestros/clientes");
    expect(link.textContent).toBe("Cliente: QA Convertido SA");
    expect(boton("Editar QA Convertido")).toBeNull();
    expect(boton("Pasar a cliente QA Convertido")).toBeNull();
    expect(boton("Eliminar QA Convertido")).not.toBeNull();
    // Click en la fila: no abre el formulario.
    await click(tr.querySelector("td")!);
    expect(container.querySelector("form")).toBeNull();
    // Los no convertidos sí.
    expect(fila("QA Abierto").dataset.convertido).toBeUndefined();
    expect(boton("Editar QA Abierto")).not.toBeNull();
    expect(boton("Pasar a cliente QA Abierto")).not.toBeNull();
  });

  it("filtros por Tipo, Status y Origen (el de Tipo incluye Cliente)", async () => {
    const select = (label: string) => container.querySelector<HTMLSelectElement>(`select[aria-label="Filtrar por ${label}"]`)!;
    expect([...select("Tipo").options].map((o) => o.textContent)).toEqual(["Todos", "Cliente", "Lead", "Ex Cliente", "Frío", "Partnership"]);
    expect([...select("Status").options].map((o) => o.textContent)).toEqual(["Todos", "Activo", "Concluido"]);
    expect([...select("Origen").options].map((o) => o.textContent)).toEqual(["Todos", "F&F", "Referidos", "Orgánico"]);
    const set = (s: HTMLSelectElement, v: string) =>
      act(async () => {
        s.value = v;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      });
    await set(select("Tipo"), "Cliente");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    await set(select("Tipo"), "");
    await set(select("Status"), "Concluido");
    expect(fila("QA Frío")).toBeDefined();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    await set(select("Status"), "");
    await set(select("Origen"), "Referidos");
    expect([...container.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td")!.textContent)).toEqual(["QA Abierto"]);
  });
});

describe("Leads · formulario", () => {
  it("Tipo no ofrece «Cliente»; Nombre obligatorio sin llamar al servidor", async () => {
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Nuevo lead")!);
    const form = container.querySelector("form")!;
    const tipo = [...form.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "Partnership"))!;
    expect([...tipo.options].map((o) => o.value)).toEqual(["", "Lead", "Ex Cliente", "Frío", "Partnership"]);
    expect(form.textContent).toContain("Cobranzas SRL");
    await act(async () => form.requestSubmit());
    expect(form.textContent).toContain("Este campo es obligatorio.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Leads · diálogos", () => {
  it("Eliminar: diálogo de la app con el texto exacto; confirma con DELETE", async () => {
    await click(boton("Eliminar QA Convertido")!);
    expect(dialog()!.textContent).toContain("¿Eliminar este lead? No se puede deshacer.");
    // Sin cambios (CC-F4-06-FIX): «Sí, eliminar» neutro (secundario, sin acento ni rojo) y sin campos.
    expect(dialogButton("Sí, eliminar").className).toContain("bg-card");
    expect(dialogButton("Sí, eliminar").className).not.toMatch(/bg-accent|text-danger/);
    expect(dialog()!.querySelectorAll("input")).toHaveLength(0);
    expect(LEAD_MESSAGES.eliminarConfirmacion).toBe("¿Eliminar este lead? No se puede deshacer.");
    await click(dialogButton("Sí, eliminar"));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/leads/recLLLLLLLLLLLLL2", expect.objectContaining({ method: "DELETE" }));
    expect(dialog()).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it("Eliminar: Cancelar no llama al servidor", async () => {
    await click(boton("Eliminar QA Abierto")!);
    await click(dialogButton("Cancelar"));
    expect(dialog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Pasar a cliente: texto exacto, Sigla obligatoria y de 2 letras, manda solo la sigla", async () => {
    await click(boton("Pasar a cliente QA Abierto")!);
    const d = dialog()!;
    expect(d.textContent).toContain("Este lead pasa al módulo Clientes y no se puede volver a Lead. ¿Querés continuar?");
    expect(LEAD_MESSAGES.convertirConfirmacion).toBe("Este lead pasa al módulo Clientes y no se puede volver a Lead. ¿Querés continuar?");
    // Nombre: copiado del lead, deshabilitado como los campos bloqueados de Maestros (CC-F4-06-FIX).
    const nombreInput = d.querySelector<HTMLInputElement>("input[disabled]")!;
    expect(nombreInput.value).toBe("QA Abierto");
    expect(nombreInput.readOnly).toBe(true);
    expect(nombreInput.className).toContain("disabled:opacity-50");
    expect(d.querySelectorAll("input")).toHaveLength(2);
    // Confirmar con el estilo primario (acento); Cancelar sigue secundario.
    expect(dialogButton("Pasar a cliente").className).toContain("bg-accent");
    expect(dialogButton("Pasar a cliente").className).not.toContain("text-danger");
    expect(dialogButton("Cancelar").className).not.toContain("bg-accent");
    const sigla = d.querySelector<HTMLInputElement>("input:not([disabled])")!;
    expect(document.activeElement).toBe(sigla);
    await click(dialogButton("Pasar a cliente"));
    expect(d.textContent).toContain("Ingresá la sigla del cliente.");
    await act(async () => type(sigla, "q"));
    await click(dialogButton("Pasar a cliente"));
    expect(d.textContent).toContain("La sigla de un cliente tiene que tener exactamente 2 letras.");
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => type(sigla, "qz"));
    expect(sigla.value).toBe("QZ");
    await click(dialogButton("Pasar a cliente"));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/leads/recLLLLLLLLLLLLL1/convertir", expect.objectContaining({ method: "POST", body: JSON.stringify({ sigla: "QZ" }) }));
    expect(dialog()).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it("Pasar a cliente: los errores del servidor vuelven a los campos del diálogo (Sigla tomada, Nombre tomado)", async () => {
    await click(boton("Pasar a cliente QA Abierto")!);
    const sigla = dialog()!.querySelector<HTMLInputElement>("input:not([disabled])")!;
    await act(async () => type(sigla, "QX"));
    respond(409, { error: "Revisá los campos marcados.", fieldErrors: { sigla: "Ya existe otro registro con este sigla." } });
    await click(dialogButton("Pasar a cliente"));
    expect(dialog()!.textContent).toContain("Ya existe otro registro con este sigla.");
    expect(sigla.getAttribute("aria-invalid")).toBe("true");
    respond(409, { error: "Revisá los campos marcados.", fieldErrors: { nombre: "Ya existe otro registro con este nombre." } });
    await click(dialogButton("Pasar a cliente"));
    expect(dialog()!.textContent).toContain("Ya existe otro registro con este nombre.");
    respond(503, { error: "No pudimos completar el cambio. No se modificó nada; probá de nuevo." });
    await click(dialogButton("Pasar a cliente"));
    expect(dialog()!.textContent).toContain("No pudimos completar el cambio. No se modificó nada; probá de nuevo.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
