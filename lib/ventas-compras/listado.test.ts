import { describe, expect, it } from "vitest";

import { evaluarComprobante, filtrar, ordenar, SIN_PROYECTO, totalizar, type ComprobanteGuardado, type FilaListado, type RefsListado } from "./listado";
import { MENSAJES } from "./rules";
import type { Contexto } from "./types";

const CUIT_A = "30711111118";
const CUIT_B = "30722222221";
const CLI_A = { id: "recCLIENTE00000A", nombre: "QA Cliente A" };
const CLI_P = { id: "recCLIENTE00000P", nombre: "QA Cliente del proyecto" };

const ctx: Contexto = {
  proyectos: [
    { id: "recPROYECTO0000A", codigo: "QP - Web", activo: true, cliente: CLI_P, unidadNegocio: "recUNIDAD000000A" },
    { id: "recPROYECTO0000C", codigo: "QP - Viejo", activo: false, cliente: CLI_P, unidadNegocio: null },
  ],
  unidades: [
    { id: "recUNIDAD000000A", nombre: "Consultoría" },
    { id: "recUNIDAD000000B", nombre: "Software" },
  ],
  categorias: [
    { id: "recCATINGRP0000A", nombre: "Ingresos por servicios", tipo: "Ingreso", requiereProyecto: true },
    { id: "recCATINGR00000B", nombre: "Otros ingresos", tipo: "Ingreso", requiereProyecto: false },
    { id: "recCATGASTP0000C", nombre: "Honorarios (proyectos)", tipo: "Gasto", requiereProyecto: true },
    { id: "recCATGAST00000D", nombre: "Gastos varios", tipo: "Gasto", requiereProyecto: false },
  ],
  socios: [{ id: "recSOCIO0000000A", nombre: "LR · Luciano" }],
  categoriaVentasPorDefecto: { nombre: "Ingresos por servicios", id: "recCATINGRP0000A" },
};

const refs = (clientes: [string, typeof CLI_A][] = [[CUIT_A, CLI_A]]): RefsListado => ({
  tipos: new Map([
    ["recTIPOFACTC000A", { codigo: 11, signo: 1 }],
    ["recTIPONCC00000B", { codigo: 13, signo: -1 }],
    ["recTIPOINVALID0C", { codigo: 99, signo: 0 }],
  ]),
  clientesPorCuit: new Map(clientes),
  proveedores: new Map([
    ["recPROVEEDOR000A", { nombre: "QA Proveedor", cuit: "30733333334", categoriaPorDefecto: "recCATGAST00000D" }],
    ["recPROVEEDOR000B", { nombre: "QA Sin categoría", cuit: "30744444447", categoriaPorDefecto: null }],
  ]),
});

let seq = 0;
function comp(over: Partial<ComprobanteGuardado> & { datos?: Record<string, string | number | null> } = {}): ComprobanteGuardado {
  seq++;
  return {
    id: `recCOMPROBANTE${String(seq).padStart(3, "0")}`,
    clave: `11|2|${seq}|${CUIT_A}`,
    tipoComprobanteId: "recTIPOFACTC000A",
    mesDevengado: null,
    proyecto: null,
    unidadNegocio: null,
    categoria: null,
    socio: null,
    observaciones: "",
    proveedor: null,
    ...over,
    datos: { fecha: "2026-10-15", tipo: "11 - Factura C", puntoVenta: 2, numeroDesde: seq, nroDocReceptor: CUIT_A, nroDocEmisor: "30733333334", moneda: "$", impTotal: 1210, totalIva: 210, ...over.datos },
  };
}
const v = (c: ComprobanteGuardado, r = refs()) => evaluarComprobante("ventas", c, r, ctx);
const co = (c: ComprobanteGuardado, r = refs()) => evaluarComprobante("compras", c, r, ctx);

describe("valores efectivos", () => {
  it("Mes devengado vacío → mes de la Fecha; UN vacía → la del proyecto; Categoría de Ventas vacía → Parámetro", () => {
    const r = v(comp({ proyecto: "recPROYECTO0000A" }));
    expect(r.mesDevengado).toBe("2026-10-01");
    expect(r.unidadNegocio).toEqual({ id: "recUNIDAD000000A", nombre: "Consultoría" });
    expect(r.categoria).toEqual({ id: "recCATINGRP0000A", nombre: "Ingresos por servicios" });
    expect(r.guardado).toEqual({ mesDevengado: "", proyecto: "recPROYECTO0000A", unidadNegocio: "", categoria: "", socio: "", observaciones: "" });
    const g = v(comp({ proyecto: "recPROYECTO0000A", mesDevengado: "2026-09-01", unidadNegocio: "recUNIDAD000000B", categoria: "recCATINGR00000B" }));
    expect(g).toMatchObject({ mesDevengado: "2026-09-01", unidadNegocio: { nombre: "Software" }, categoria: { nombre: "Otros ingresos" } });
  });

  it("Compras: categoría vacía → la por defecto del proveedor", () => {
    expect(co(comp({ proveedor: "recPROVEEDOR000A" })).categoria).toEqual({ id: "recCATGAST00000D", nombre: "Gastos varios" });
    expect(co(comp({ proveedor: "recPROVEEDOR000A" })).contraparte).toEqual({ id: "recPROVEEDOR000A", nombre: "QA Proveedor" });
  });
});

describe("Cliente efectivo (Ventas)", () => {
  it("del proyecto (aunque el CUIT coincida con otro cliente)", () => {
    expect(v(comp({ proyecto: "recPROYECTO0000A" })).contraparte).toEqual(CLI_P);
  });
  it("por CUIT del receptor (Activo o Inactivo, la regla no mira el Estado)", () => {
    expect(v(comp()).contraparte).toEqual(CLI_A);
  });
  it("ninguno → Control «Cliente sin identificar»", () => {
    const r = v(comp({ categoria: "recCATINGR00000B", datos: { nroDocReceptor: CUIT_B } }));
    expect(r.contraparte).toBeNull();
    expect(r.control).toBe(MENSAJES.sinCliente);
  });
  it("cargar el CUIT en Clientes después arregla la fila sin tocarla", () => {
    const c = comp({ categoria: "recCATINGR00000B", datos: { nroDocReceptor: CUIT_B } });
    expect(v(c).contraparte).toBeNull();
    const despues = v(c, refs([[CUIT_A, CLI_A], [CUIT_B, { id: "recCLIENTE00000B", nombre: "QA Cliente B" }]]));
    expect(despues.contraparte).toEqual({ id: "recCLIENTE00000B", nombre: "QA Cliente B" });
    expect(despues.control).toBe(MENSAJES.ok);
  });
});

describe("Control en la lista (mismo orden que la importación)", () => {
  it.each([
    ["tipo no reconocido", { tipoComprobanteId: "recTIPOINVALID0C" }, MENSAJES.tipoNoReconocido],
    ["categoría inexistente", { categoria: "recNOEXISTE00000X" }, MENSAJES.categoriaInexistente],
    ["no es de ingreso", { categoria: "recCATGAST00000D" }, MENSAJES.noEsIngreso],
    ["proyecto inexistente", { proyecto: "recNOEXISTE00000X" }, MENSAJES.proyectoInexistente],
    ["falta proyecto", {}, MENSAJES.faltaProyecto],
    ["cliente sin identificar", { categoria: "recCATINGR00000B", datos: { nroDocReceptor: CUIT_B } }, MENSAJES.sinCliente],
    ["OK", { proyecto: "recPROYECTO0000A" }, MENSAJES.ok],
  ])("Ventas: %s", (_n, over, control) => {
    expect(v(comp(over as Partial<ComprobanteGuardado>)).control).toBe(control);
  });

  it.each([
    ["tipo no reconocido", { tipoComprobanteId: "recTIPOINVALID0C" }, MENSAJES.tipoNoReconocido],
    ["socio inexistente", { socio: "recNOEXISTE00000X" }, MENSAJES.socioInexistente],
    ["falta categoría", { proveedor: "recPROVEEDOR000B" }, MENSAJES.faltaCategoria],
    ["categoría inexistente", { categoria: "recNOEXISTE00000X" }, MENSAJES.categoriaInexistente],
    ["no es de gasto", { categoria: "recCATINGR00000B" }, MENSAJES.noEsGasto],
    ["proyecto inexistente", { categoria: "recCATGAST00000D", proyecto: "recNOEXISTE00000X" }, MENSAJES.proyectoInexistente],
    ["falta proyecto", { categoria: "recCATGASTP0000C" }, MENSAJES.faltaProyecto],
    ["socio sin categoría → OK", { proveedor: "recPROVEEDOR000B", socio: "recSOCIO0000000A" }, MENSAJES.ok],
    ["OK", { proveedor: "recPROVEEDOR000A" }, MENSAJES.ok],
  ])("Compras: %s", (_n, over, control) => {
    expect(co(comp(over as Partial<ComprobanteGuardado>)).control).toBe(control);
  });

  it("Compras: impacto en resultados y a cuenta del socio", () => {
    expect(co(comp({ proveedor: "recPROVEEDOR000A" })).importes).toMatchObject({ neto: 100000, impacto: -100000, cuentaSocio: 0 });
    expect(co(comp({ proveedor: "recPROVEEDOR000A", socio: "recSOCIO0000000A" })).importes).toMatchObject({ neto: 100000, impacto: 0, cuentaSocio: 100000 });
  });
});

describe("filtros y totales", () => {
  const rows: FilaListado[] = [
    v(comp({ proyecto: "recPROYECTO0000A", datos: { fecha: "2026-10-01" } })), // OK, mes 10
    v(comp({ tipoComprobanteId: "recTIPONCC00000B", proyecto: "recPROYECTO0000A", mesDevengado: "2026-09-01", datos: { impTotal: 605.5, totalIva: 105.5 } })), // NC, mes 09
    v(comp({ datos: { moneda: "DOL", tipoCambio: 1000.5, impTotal: 100.01, totalIva: 17.36, otrosTributos: 0.5 } })), // USD, falta proyecto
    v(comp({ categoria: "recCATINGR00000B", datos: { nroDocReceptor: CUIT_B } })), // sin cliente
  ];

  it("totales en centavos incluyen NC (resta) y USD con TC", () => {
    expect(totalizar(rows)).toEqual({
      total: 121000 - 60550 + 10006001 + 121000,
      iva: 21000 - 10550 + 1736868 + 21000,
      neto: 100000 - 50000 + 8219108 + 100000,
      impacto: 0,
      cuentaSocio: 0,
    });
  });

  it("Mes devengado efectivo, cliente, proyecto (incl. sin proyecto), categoría efectiva y Control", () => {
    expect(filtrar(rows, { mesDesde: "2026-10", mesHasta: "2026-10" })).toHaveLength(3);
    expect(filtrar(rows, { mesHasta: "2026-09" })).toEqual([rows[1]]);
    expect(filtrar(rows, { contraparte: CLI_P.id })).toEqual([rows[0], rows[1]]);
    expect(filtrar(rows, { contraparte: CLI_A.id })).toEqual([rows[2]]);
    expect(filtrar(rows, { proyecto: SIN_PROYECTO })).toEqual([rows[2], rows[3]]);
    expect(filtrar(rows, { proyecto: "recPROYECTO0000A" })).toEqual([rows[0], rows[1]]);
    expect(filtrar(rows, { categoria: "recCATINGRP0000A" })).toEqual([rows[0], rows[1], rows[2]]); // la por defecto
    expect(filtrar(rows, { categoria: "recCATINGR00000B" })).toEqual([rows[3]]);
    expect(filtrar(rows, { control: "ok" })).toEqual([rows[0], rows[1]]);
    expect(filtrar(rows, { control: "observaciones" })).toEqual([rows[2], rows[3]]);
    expect(filtrar(rows, { control: "faltaProyecto" })).toEqual([rows[2]]);
    expect(filtrar(rows, { control: "sinCliente" })).toEqual([rows[3]]);
    expect(filtrar(rows, {})).toHaveLength(4);
  });

  it("orden: Fecha desc", () => {
    expect(ordenar([...rows]).map((r) => r.datos.fecha)).toEqual(["2026-10-15", "2026-10-15", "2026-10-15", "2026-10-01"]);
  });
});
