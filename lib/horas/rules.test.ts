import { describe, expect, it } from "vitest";

import { HORA_MESSAGES, mesDeFecha, mesFormAlCambiarFecha, mesFormInicial, overlapMessage, overlapping, rangesOverlap, TAREA_MAX, validateHora } from "./rules";

const ok = { fecha: "2026-11-12", proyecto: "recPPPPPPPPPPPPPP", tarea: " Diseño ", desde: "09:00", hasta: "10:30" };

describe("validateHora", () => {
  it("normaliza un registro válido", () => {
    expect(validateHora(ok, "empleado")).toEqual({
      values: { fecha: "2026-11-12", proyecto: "recPPPPPPPPPPPPPP", tarea: "Diseño", desde: 32_400, hasta: 37_800 },
      errors: {},
    });
  });

  it("obligatorios, hasta > desde y tarea ≤ 1000", () => {
    expect(validateHora({}, "empleado").errors).toEqual({
      fecha: HORA_MESSAGES.fecha,
      proyecto: HORA_MESSAGES.proyecto,
      tarea: HORA_MESSAGES.tarea,
      desde: HORA_MESSAGES.hora,
      hasta: HORA_MESSAGES.hora,
    });
    expect(validateHora({ ...ok, hasta: "09:00" }, "empleado").errors).toEqual({ hasta: HORA_MESSAGES.rango });
    expect(validateHora({ ...ok, hasta: "08:00" }, "empleado").errors).toEqual({ hasta: HORA_MESSAGES.rango });
    expect(validateHora({ ...ok, hasta: "24:00" }, "empleado").errors).toEqual({ hasta: HORA_MESSAGES.hora });
    expect(validateHora({ ...ok, tarea: "x".repeat(TAREA_MAX) }, "empleado").errors).toEqual({});
    expect(validateHora({ ...ok, tarea: "x".repeat(TAREA_MAX + 1) }, "empleado").errors).toEqual({ tarea: HORA_MESSAGES.tareaLarga });
    expect(validateHora({ ...ok, tarea: "   " }, "empleado").errors).toEqual({ tarea: HORA_MESSAGES.tarea });
    expect(validateHora({ ...ok, fecha: "2026-02-30" }, "empleado").errors).toEqual({ fecha: HORA_MESSAGES.fecha });
    expect(validateHora({ ...ok, proyecto: "no-es-id" }, "empleado").errors).toEqual({ proyecto: HORA_MESSAGES.proyecto });
  });

  it("Empleado: ignora colaborador, facturable y mes a facturar", () => {
    const { values } = validateHora({ ...ok, colaborador: "recXXXXXXXXXXXXXX", facturable: false, mesAFacturar: "2026-11" }, "empleado");
    expect(values).not.toHaveProperty("colaborador");
    expect(values).not.toHaveProperty("facturable");
    expect(values).not.toHaveProperty("mesAFacturar");
  });

  it("Admin: colaborador y mes a facturar obligatorios; facturable opcional", () => {
    expect(validateHora(ok, "admin").errors).toEqual({ colaborador: HORA_MESSAGES.colaborador });
    const { values } = validateHora({ ...ok, colaborador: ["recCCCCCCCCCCCCCC"], facturable: false, mesAFacturar: "2026-12" }, "admin");
    expect(values).toMatchObject({ colaborador: "recCCCCCCCCCCCCCC", facturable: false, mesAFacturar: "2026-12-01" });
    for (const vacio of ["", null]) expect(validateHora({ ...ok, colaborador: "recCCCCCCCCCCCCCC", mesAFacturar: vacio }, "admin").errors).toEqual({ mesAFacturar: "Elegí el mes a facturar." });
    // Sin la clave (edición que no lo toca): undefined, el servicio decide con el guardado.
    expect(validateHora({ ...ok, colaborador: "recCCCCCCCCCCCCCC" }, "admin").values).not.toHaveProperty("mesAFacturar");
    expect(validateHora({ ...ok, colaborador: "recCCCCCCCCCCCCCC", mesAFacturar: "12/2026" }, "admin").errors).toEqual({ mesAFacturar: HORA_MESSAGES.mes });
  });
});

describe("superposición", () => {
  const r = (desde: number, hasta: number) => ({ desde: desde * 3600, hasta: hasta * 3600 });
  it("se pisan / se tocan", () => {
    expect(rangesOverlap(r(10, 12), r(11, 13))).toBe(true);
    expect(rangesOverlap(r(10, 12), r(9, 10.5))).toBe(true);
    expect(rangesOverlap(r(10, 12), r(10.5, 11))).toBe(true); // contenido
    expect(rangesOverlap(r(10, 12), r(9, 13))).toBe(true); // contiene
    expect(rangesOverlap(r(10, 12), r(10, 12))).toBe(true);
    expect(rangesOverlap(r(10, 12), r(12, 13))).toBe(false); // se tocan
    expect(rangesOverlap(r(10, 12), r(8, 10))).toBe(false);
  });

  it("lista los rangos en conflicto, ordenados, en el mensaje", () => {
    const found = overlapping(r(9, 12), [r(11, 13), r(8, 9.5), r(12, 14)]);
    expect(found).toEqual([r(8, 9.5), r(11, 13)]);
    expect(overlapMessage(found)).toBe("Ese horario se superpone con otro registro del mismo día (08:00–09:30, 11:00–13:00).");
  });
});

describe("Mes a facturar en el formulario de Admin (CC-F4-03)", () => {
  it("mesDeFecha: el mes de la Fecha, guardado como día 1", () => {
    expect(mesDeFecha("2030-03-31")).toBe("2030-03-01");
    expect(mesDeFecha("2031-12-01")).toBe("2031-12-01");
    expect(mesDeFecha("2030-02-30")).toBeNull();
  });

  it("alta: precargado con el mes de la Fecha y lo sigue hasta que se cambia a mano", () => {
    let mes = mesFormInicial(null, "2030-03-15");
    expect(mes).toBe("2030-03");
    let sigue = true;
    mes = mesFormAlCambiarFecha(mes, "2030-05-02", sigue);
    expect(mes).toBe("2030-05");
    // Una fecha a medio escribir (inválida) no lo borra.
    expect(mesFormAlCambiarFecha(mes, "", sigue)).toBe("2030-05");
    // El Admin lo cambia a mano → deja de seguir a la Fecha.
    mes = "2030-07";
    sigue = false;
    expect(mesFormAlCambiarFecha(mes, "2030-09-10", sigue)).toBe("2030-07");
    // Vaciarlo a mano también cuenta como cambio: queda vacío y el guardado pide el mes.
    expect(mesFormAlCambiarFecha("", "2030-09-10", false)).toBe("");
    expect(validateHora({ ...ok, colaborador: "recCCCCCCCCCCCCCC", mesAFacturar: "" }, "admin").errors.mesAFacturar).toBe(HORA_MESSAGES.mesRequerido);
  });

  it("edición: muestra el guardado y cambiar la Fecha no lo toca; legacy vacío → el mes de la Fecha", () => {
    const guardado = mesFormInicial("2030-04-01", "2030-03-20");
    expect(guardado).toBe("2030-04");
    expect(mesFormAlCambiarFecha(guardado, "2030-06-01", false)).toBe("2030-04");
    const legacy = mesFormInicial(null, "2030-03-20");
    expect(legacy).toBe("2030-03");
    expect(validateHora({ ...ok, fecha: "2030-03-20", colaborador: "recCCCCCCCCCCCCCC", mesAFacturar: legacy }, "admin").values!.mesAFacturar).toBe("2030-03-01");
  });
});
