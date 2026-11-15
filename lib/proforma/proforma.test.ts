import { describe, expect, it } from "vitest";

import { calcularProforma, isMesProforma, mesEfectivo, parseAlicuota, PROFORMA_MESSAGES, type HoraP, type ProyectoP } from "./proforma";

/** Valores esperados calculados a mano (centavos). Mes: 10/2026. */
const C1 = { id: "recCLIENTE1000000", nombre: "QA Cliente Uno", sigla: "QA", cuit: "30711111118", condicionIva: "Responsable Inscripto" };
const proyectos: ProyectoP[] = [
  { id: "recPROYWEB0000000", codigo: "QA - Web", cliente: C1.id, valorHora: 1234.57, moneda: "ARS" },
  { id: "recPROYSOP0000000", codigo: "QA - Soporte", cliente: C1.id, valorHora: 50, moneda: "USD" },
  { id: "recPROYSIN0000000", codigo: "QA - Sin valor", cliente: C1.id, valorHora: null, moneda: null },
  { id: "recPROYOTRO000000", codigo: "QB - Otro", cliente: "recCLIENTE2000000", valorHora: 1000, moneda: "ARS" },
];
const [WEB, SOP, SIN, OTRO] = proyectos.map((p) => p.id);
const t = (hhmm: string) => Number(hhmm.slice(0, 2)) * 3600 + Number(hhmm.slice(3)) * 60;
let n = 0;
const hora = (proyecto: string, fecha: string, desde: string, hasta: string, o: Partial<HoraP> = {}): HoraP => ({
  id: `recHORA${String(++n).padStart(10, "0")}`,
  fecha,
  colaborador: "recUSUARIOANA0000",
  proyecto,
  tarea: `Tarea ${n}`,
  desde: t(desde),
  hasta: t(hasta),
  facturable: true,
  mesAFacturar: null,
  ...o,
});
const H = {
  h1: hora(WEB, "2026-10-05", "09:00", "09:20"), // 0,33 h
  h2: hora(WEB, "2026-10-05", "10:00", "10:20"), // 0,33 h
  h3: hora(WEB, "2026-10-06", "09:00", "09:20"), // 0,33 h
  h4: hora(WEB, "2026-10-07", "09:00", "10:00", { facturable: false }), // no facturable
  h5: hora(WEB, "2026-09-30", "08:00", "09:30", { mesAFacturar: "2026-10-01" }), // Mes a facturar = 10/2026 (Fecha de sep)
  h6: hora(WEB, "2026-10-31", "09:00", "10:00", { mesAFacturar: "2026-11-01" }), // Mes a facturar = otro mes
  h7: hora(WEB, "2026-11-01", "09:00", "10:00"), // mes siguiente
  h8: hora(WEB, "2026-09-30", "09:00", "10:00"), // mes anterior
  h9: hora(SOP, "2026-10-10", "14:00", "16:30", { colaborador: "recUSUARIOBETO000" }), // USD 2,5 h
  h10: hora(SIN, "2026-10-12", "09:00", "10:00"), // sin valor hora
  h11: hora(OTRO, "2026-10-05", "09:00", "10:00"), // otro cliente
  h12: hora(WEB, "2026-10-31", "00:00", "01:00", { tarea: "Cierre de mes" }), // último día, desde 00:00
};
const colaboradores = new Map([
  ["recUSUARIOANA0000", "Ana Admin"],
  ["recUSUARIOBETO000", "Beto Empleado"],
]);
const base = { cliente: C1, mes: "2026-10", alicuota: 0.21, proyectos, horas: Object.values(H), colaboradores };

describe("alícuota del Parámetro", () => {
  it.each([
    ["0.21", 0.21],
    ["0,21", 0.21],
    ["21%", 0.21],
    ["21 %", 0.21],
    ["21", 0.21],
    [" 10,5% ", 0.105],
    ["0", 0],
    ["100", 1],
    ["1", 1],
  ])("«%s» → %s", (v, rate) => expect(parseAlicuota(v)).toBe(rate));

  it.each(["", "  ", "abc", "-0.21", "121", "21%%", "0.21.0", "1.2.3", "veintiuno", "%"])("«%s» → inválida", (v) => expect(parseAlicuota(v)).toBeNull());
  it("vacío o de otro tipo → inválida", () => {
    expect(parseAlicuota(null)).toBeNull();
    expect(parseAlicuota(undefined)).toBeNull();
    expect(parseAlicuota(["0.21"])).toBeNull();
  });
});

describe("mes", () => {
  it("válido de 2000-01 a 2099-12; mes efectivo = Mes a facturar o el de la Fecha", () => {
    for (const ok of ["2000-01", "2026-10", "2099-12"]) expect(isMesProforma(ok), ok).toBe(true);
    for (const bad of ["1999-12", "2100-01", "2026-13", "2026-1", "", null]) expect(isMesProforma(bad), String(bad)).toBe(false);
    expect(mesEfectivo({ mesAFacturar: "2026-11-01", fecha: "2026-10-31" })).toBe("2026-11");
    expect(mesEfectivo({ mesAFacturar: null, fecha: "2026-10-31" })).toBe("2026-10");
    expect(mesEfectivo({ mesAFacturar: null, fecha: null })).toBeNull();
  });
});

describe("calcularProforma", () => {
  const d = calcularProforma(base);

  it("encabezado: CUIT con guiones, Condición IVA, mes y alícuota", () => {
    expect(d.cliente).toEqual({ id: C1.id, nombre: "QA Cliente Uno", sigla: "QA", cuit: "30-71111111-8", condicionIva: "Responsable Inscripto" });
    expect(d.mesLabel).toBe("10/2026");
    expect(d.alicuotaLabel).toBe("IVA 21 %");
    const sinDatos = calcularProforma({ ...base, cliente: { ...C1, cuit: null, condicionIva: null } });
    expect(sinDatos.cliente).toMatchObject({ cuit: "—", condicionIva: "—" });
    expect(calcularProforma({ ...base, alicuota: 0.105 }).alicuotaLabel).toBe("IVA 10,5 %");
  });

  it("cuentan: facturable, del cliente, con Mes a facturar efectivo = el mes (bordes incluidos)", () => {
    expect(d.detalle.map((r) => r.id)).toEqual([H.h5, H.h1, H.h2, H.h3, H.h9, H.h10, H.h12].map((h) => h.id)); // orden: Fecha, después Hora desde
  });

  it("importe por registro (ROUND de cada uno), no horas totales × valor hora", () => {
    const tercio = d.detalle.filter((r) => [H.h1.id, H.h2.id, H.h3.id].includes(r.id));
    expect(tercio.map((r) => [r.horas, r.importe])).toEqual([
      [0.33, 40741],
      [0.33, 40741],
      [0.33, 40741],
    ]); // 0,33 × 1.234,57 = 407,4081 → 407,41
    expect(tercio.reduce((s, r) => s + r.importe!, 0)).toBe(122223); // ≠ ROUND(0,99 × 1.234,57) = 1.222,22
  });

  it("resumen por proyecto por Código; el proyecto sin valor hora queda con aviso y sin importe", () => {
    expect(d.proyectos).toEqual([
      { id: SIN, codigo: "QA - Sin valor", horas: 1, valorHora: null, moneda: null, importe: null, aviso: PROFORMA_MESSAGES.faltaValorHora },
      { id: SOP, codigo: "QA - Soporte", horas: 2.5, valorHora: 50, moneda: "USD", importe: 12500, aviso: null },
      // 0,33 × 3 + 1,5 + 1 = 3,49 h; 407,41 × 3 + 1.851,86 + 1.234,57 = 4.308,66
      { id: WEB, codigo: "QA - Web", horas: 3.49, valorHora: 1234.57, moneda: "ARS", importe: 430866, aviso: null },
    ]);
    expect(d.incompleta).toBe(true);
    expect(d.vacia).toBe(false);
  });

  it("totales por moneda (ARS y USD); el proyecto sin valor hora no suma", () => {
    expect(d.totales).toEqual([
      { moneda: "ARS", subtotal: 430866, iva: 90482, total: 521348 }, // IVA = ROUND(4.308,66 × 0,21) = 904,82
      { moneda: "USD", subtotal: 12500, iva: 2625, total: 15125 },
    ]);
  });

  it("detalle: colaborador, proyecto, tarea, horas, valor hora, moneda e importe", () => {
    expect(d.detalle[0]).toMatchObject({ fecha: "2026-09-30", colaborador: "Ana Admin", proyecto: "QA - Web", tarea: "Tarea 5", horas: 1.5, valorHora: 1234.57, moneda: "ARS", importe: 185186 });
    expect(d.detalle.find((r) => r.id === H.h9.id)).toMatchObject({ colaborador: "Beto Empleado", importe: 12500, moneda: "USD" });
    expect(d.detalle.find((r) => r.id === H.h10.id)).toMatchObject({ valorHora: null, moneda: null, importe: null });
    expect(d.detalle.at(-1)).toMatchObject({ fecha: "2026-10-31", tarea: "Cierre de mes", horas: 1, importe: 123457 });
  });

  it("solo una moneda: no aparece la otra", () => {
    const soloUsd = calcularProforma({ ...base, horas: [H.h9] });
    expect(soloUsd.totales.map((x) => x.moneda)).toEqual(["USD"]);
    expect(soloUsd.incompleta).toBe(false);
  });

  it("sin horas que cuenten → vacía", () => {
    const vacia = calcularProforma({ ...base, mes: "2026-08" });
    expect(vacia).toMatchObject({ vacia: true, proyectos: [], totales: [], detalle: [], incompleta: false });
    expect(PROFORMA_MESSAGES.vacia(vacia.mesLabel)).toBe("No hay horas facturables de este cliente en 08/2026.");
  });
});
