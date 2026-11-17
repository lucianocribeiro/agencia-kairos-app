// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { MesAnioInput, MES_ANIO_MESSAGES, estadoMesAnio } = await import("./mes-anio-select");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mes + Año compartido (CC-F4-07): opciones, precarga, vacío, incompleto, año fuera de rango, formularios GET. */
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (el: React.ReactNode) => act(() => root.render(el));
const mes = (label: string) => container.querySelector<HTMLSelectElement>(`select[aria-label="${label}: mes"]`)!;
const anio = (label: string) => container.querySelector<HTMLSelectElement>(`select[aria-label="${label}: año"]`)!;
const pick = (s: HTMLSelectElement, v: string) =>
  act(async () => {
    s.value = v;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });

describe("MesAnioInput", () => {
  it("opciones: Mes + Enero…Diciembre (01–12); Año + 2000…2099; nombres accesibles propios", () => {
    render(<MesAnioInput label="Mes X" value="" />);
    expect([...mes("Mes X").options].map((o) => o.textContent)).toEqual(["Mes", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]);
    expect([...mes("Mes X").options].map((o) => o.value).slice(1)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]);
    const anios = [...anio("Mes X").options].map((o) => o.textContent);
    expect(anios).toHaveLength(101);
    expect([anios[0], anios[1], anios.at(-1)]).toEqual(["Año", "2000", "2099"]);
    expect(container.querySelector('input[type="month"]')).toBeNull();
  });

  it("precarga «AAAA-MM» → Marzo / 2030", () => {
    render(<MesAnioInput label="Mes X" value="2030-03" />);
    expect(mes("Mes X").value).toBe("03");
    expect(anio("Mes X").value).toBe("2030");
  });

  it("año guardado fuera de 2000–2099: aparece en Año", () => {
    render(<MesAnioInput label="Mes X" value="1999-12" />);
    expect(anio("Mes X").value).toBe("1999");
    expect([...anio("Mes X").options].map((o) => o.value).slice(0, 3)).toEqual(["", "1999", "2000"]);
  });

  it("completo → «AAAA-MM»; los dos vacíos → \"\"; uno solo → null y «Completá mes y año.»", async () => {
    const onChange = vi.fn();
    function Host() {
      const [v, setV] = useState<string | null>("");
      return (
        <MesAnioInput
          label="Mes X"
          value={v}
          onChange={(n) => {
            onChange(n);
            setV(n);
          }}
        />
      );
    }
    render(<Host />);
    await pick(mes("Mes X"), "03");
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(container.textContent).toContain("Completá mes y año.");
    expect(mes("Mes X").getAttribute("aria-invalid")).toBe("true");
    await pick(anio("Mes X"), "2030");
    expect(onChange).toHaveBeenLastCalledWith("2030-03");
    expect(container.textContent).not.toContain("Completá mes y año.");
    await pick(mes("Mes X"), "");
    expect(onChange).toHaveBeenLastCalledWith(null);
    await pick(anio("Mes X"), "");
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(container.textContent).not.toContain("Completá mes y año.");
    expect(MES_ANIO_MESSAGES.incompleto).toBe("Completá mes y año.");
    expect([estadoMesAnio({ mes: "", anio: "" }), estadoMesAnio({ mes: "03", anio: "" }), estadoMesAnio({ mes: "03", anio: "2030" })]).toEqual(["vacio", "incompleto", "completo"]);
  });

  it("un valor nuevo desde afuera (p. ej. limpiar filtros) reemplaza lo elegido", async () => {
    function Host() {
      const [v, setV] = useState("2030-03");
      return (
        <>
          <MesAnioInput label="Mes X" value={v} onChange={(n) => n !== null && setV(n)} />
          <button onClick={() => setV("")}>Limpiar</button>
        </>
      );
    }
    render(<Host />);
    await pick(anio("Mes X"), "");
    expect(container.textContent).toContain("Completá mes y año.");
    await act(async () => container.querySelector("button")!.click());
    expect([mes("Mes X").value, anio("Mes X").value]).toEqual(["", ""]);
    expect(container.textContent).not.toContain("Completá mes y año.");
  });

  it("formulario GET: input oculto con el name y «AAAA-MM»; obligatorio vacío o incompleto no se envía", async () => {
    render(
      <form>
        <MesAnioInput label="Mes X" name="desde" defaultValue="2026-01" required />
      </form>,
    );
    const form = container.querySelector("form")!;
    const qs = () => new URLSearchParams(new FormData(form) as unknown as Record<string, string>).toString();
    expect(qs()).toBe("desde=2026-01");
    const submit = () => {
      const e = new Event("submit", { cancelable: true, bubbles: true });
      form.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(submit()).toBe(false);
    await pick(anio("Mes X"), "");
    expect(qs()).toBe("desde=");
    expect(await act(async () => submit())).toBe(true);
    expect(container.textContent).toContain("Completá mes y año.");
    await pick(mes("Mes X"), "");
    expect(await act(async () => submit())).toBe(true); // obligatorio: vacío tampoco
    await pick(mes("Mes X"), "03");
    await pick(anio("Mes X"), "2030");
    expect(qs()).toBe("desde=2030-03");
    expect(submit()).toBe(false);
  });
});
