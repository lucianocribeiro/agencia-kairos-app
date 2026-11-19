import { describe, expect, it } from "vitest";

import { afipRow } from "@/test/afipsdk-fixture";
import { cuitSintetico } from "@/test/arca-fixture";
import { COLUMNS, type Kind } from "@/lib/ventas-compras/columns";
import { buildRows, COLUMNAS_POR_ALICUOTA, findHeader, type Cell, type Referencias } from "@/lib/ventas-compras/rows";
import { MENSAJES } from "@/lib/ventas-compras/rules";
import { adaptArcaRows, ARCA_ADAPTER_MESSAGES } from "./adapter";

const CUIT = cuitSintetico("30", 55555555);
const CUIT_EMISOR = cuitSintetico("27", 66666666);

const refs: Referencias = {
  tipos: new Map([
    [11, { id: "recTIPO11000000000", signo: 1 }],
    [13, { id: "recTIPO13000000000", signo: -1 }],
  ]),
  clientesPorCuit: new Map(),
  proveedoresPorCuit: new Map(),
  clavesExistentes: new Set(),
};

function adapt(kind: Kind, rows: unknown[]) {
  const r = adaptArcaRows(kind, rows);
  if (!r.ok) throw new Error(r.error);
  return r;
}

function filas(kind: Kind, rows: unknown[]) {
  const { sheet } = adapt(kind, rows);
  const header = findHeader(kind, sheet, "arca");
  if ("error" in header) throw new Error(header.error);
  const out = buildRows(kind, sheet, header, refs, "arca");
  if ("error" in out) throw new Error(out.error);
  return out;
}

/** La misma fila como la tendría un .xlsx de ARCA (todas las columnas del parser). */
function excelSheet(kind: Kind, values: Record<string, Cell>): Cell[][] {
  return [COLUMNS[kind].map((c) => c.header), COLUMNS[kind].map((c) => values[c.key] ?? null)];
}

describe("adaptArcaRows · mapa de encabezados", () => {
  it("nombres documentados de Afip SDK → columnas del parser; Ventas sin Emisor", () => {
    const [f] = filas("ventas", [afipRow("ventas", { "Nro. Doc. Receptor": CUIT, IVA: "210,00", "Imp. Total": "1210,00", "Imp. Neto Gravado": "1000,00" })]);
    expect(f.error).toBeNull();
    expect(f.datos).toMatchObject({ fecha: "2026-10-15", tipo: "11 - Factura C", puntoVenta: 2, numeroDesde: 1, totalIva: 210, impTotal: 1210, netoGravadoTotal: 1000, nroDocReceptor: CUIT });
    expect(f.importes).toEqual({ total: 121000, iva: 21000, otros: 0, neto: 100000 });
  });

  it("acepta también los nombres del parser («Fecha», «Tipo», «Total IVA»…) y mayúsculas/tildes", () => {
    const row = { Fecha: "2026-10-15", TIPO: "11", "Punto de Venta": 2, "Numero Desde": 7, "Número Hasta": 7, "Cód. Autorización": "1", "Tipo Doc. Receptor": "CUIT", "Nro. Doc. Receptor": CUIT, "Denominación Receptor": "QA", "Tipo Cambio": 1, Moneda: "PES", "Neto Gravado Total": 0, "Neto No Gravado": 0, "Op. Exentas": 0, "Otros Tributos": 0, "Total IVA": 0, "Imp. Total": 500 };
    const [f] = filas("ventas", [row]);
    expect(f.error).toBeNull();
    expect(f.codigo).toBe(11);
    expect(f.datos.numeroDesde).toBe(7);
  });

  it("las 11 columnas por alícuota son opcionales solo para ARCA (si vienen, se usan)", () => {
    const sin = filas("ventas", [afipRow("ventas")])[0];
    for (const key of COLUMNAS_POR_ALICUOTA) expect(sin.datos[key]).toBeNull();
    const con = filas("ventas", [afipRow("ventas", { "IVA 21%": "210,00", "Neto Grav. IVA 21%": "1000,00" })])[0];
    expect(con.datos.iva21).toBe(210);
    expect(con.datos.netoGravIva21).toBe(1000);
  });

  it("el .xlsx sigue exigiendo las columnas por alícuota (source excel)", () => {
    const { sheet } = adapt("ventas", [afipRow("ventas")]);
    const header = findHeader("ventas", sheet); // excel por defecto
    expect(header).toEqual({ error: expect.stringContaining("Faltan las columnas «Neto Grav. IVA 0%»") });
  });

  it("Compras: mapea Emisor; el receptor (la empresa) es opcional", () => {
    const [f] = filas("compras", [afipRow("compras", { "Nro. Doc. Emisor": CUIT_EMISOR, "Denominación Emisor": "QA Prov" })]);
    expect(f.error).toBeNull();
    expect(f.proveedor).toEqual({ id: null, nombre: "QA Prov", cuit: CUIT_EMISOR, categoriaPorDefecto: null });
    expect(f.clave).toBe(`11|2|1|${CUIT_EMISOR}`);
  });
});

describe("diagnóstico de columnas", () => {
  it("Compras sin las columnas del Emisor → nombres que faltan y nombres recibidos, nunca valores", () => {
    const row = afipRow("ventas", { "Nro. Doc. Receptor": CUIT, "Denominación Receptor": "Valor que no se muestra" });
    const r = adaptArcaRows("compras", [row]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("faltan_columnas");
    expect(r.error).toMatch(/^Faltan columnas en la respuesta de ARCA: «Tipo Doc\. Emisor», «Nro\. Doc\. Emisor», «Denominación Emisor» · Columnas recibidas: /);
    expect(r.error).toContain("Denominación Receptor");
    expect(r.error).not.toContain(CUIT);
    expect(r.error).not.toContain("Valor que no se muestra");
    expect(r.error).not.toContain("1000,00");
  });

  it("muestra el nombre documentado de lo que falta (p. ej. «Fecha de Emisión»)", () => {
    const row = afipRow("ventas");
    delete row["Fecha de Emisión"];
    delete row.IVA;
    const r = adaptArcaRows("ventas", [row]);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("«Fecha de Emisión», «IVA»") });
  });

  it("nombres raros: sin caracteres de control y acotados", () => {
    const r = adaptArcaRows("ventas", [{ ["X\u0000\n" + "y".repeat(100)]: "1" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).not.toMatch(/[\u0000-\u001f]/);
    expect(r.error).toContain(`X ${"y".repeat(58)}…`);
  });

  it("respuesta vacía, no-array o con filas que no son objetos; más de 1.000", () => {
    expect(adaptArcaRows("ventas", [])).toMatchObject({ ok: false, code: "sin_comprobantes", error: ARCA_ADAPTER_MESSAGES.sinComprobantes });
    expect(adaptArcaRows("ventas", { rows: [] })).toMatchObject({ ok: false, code: "formato" });
    expect(adaptArcaRows("ventas", [1, 2])).toMatchObject({ ok: false, code: "formato" });
    expect(adaptArcaRows("ventas", Array.from({ length: 1001 }, () => afipRow("ventas")))).toMatchObject({ ok: false, error: ARCA_ADAPTER_MESSAGES.demasiadas(1001) });
  });
});

describe("valores", () => {
  it("tipo: «11 - Factura C» y «11» → 11; «Factura C» → «Tipo de comprobante no reconocido»", () => {
    const out = filas("ventas", [
      afipRow("ventas", { "Tipo de Comprobante": "11 - Factura C", "Número Desde": "1" }),
      afipRow("ventas", { "Tipo de Comprobante": "11", "Número Desde": "2" }),
      afipRow("ventas", { "Tipo de Comprobante": 11, "Número Desde": "3" }),
      afipRow("ventas", { "Tipo de Comprobante": "Factura C", "Número Desde": "4" }),
    ]);
    expect(out.map((f) => f.codigo)).toEqual([11, 11, 11, null]);
    expect(out[3]).toMatchObject({ estado: "error", error: MENSAJES.tipoNoReconocido });
  });

  it("importes con coma decimal y miles; nota de crédito con importes negativos o positivos", () => {
    const [f, nc, ncNeg] = filas("ventas", [
      afipRow("ventas", { "Imp. Total": "1.234.567,89", IVA: "4687,20", "Número Desde": "1" }),
      afipRow("ventas", { "Tipo de Comprobante": "13 - Nota de Crédito C", "Imp. Total": "100,50", "Número Desde": "2" }),
      afipRow("ventas", { "Tipo de Comprobante": "13 - Nota de Crédito C", "Imp. Total": "-100,50", "Número Desde": "3" }),
    ]);
    expect(f.datos.impTotal).toBe(1234567.89);
    expect(f.datos.totalIva).toBe(4687.2);
    expect(nc.importes.total).toBe(-10050);
    expect(ncNeg.datos.impTotal).toBe(-100.5);
    expect(ncNeg.error).toBeNull();
  });

  it("números de comprobante 1..N (no hay hoja)", () => {
    const out = filas("ventas", [afipRow("ventas", { "Número Desde": "10" }), afipRow("ventas", { "Número Desde": "11" })]);
    expect(out.map((f) => f.fila)).toEqual([1, 2]);
  });

  it("objetos o arrays en una celda → «Número inválido», no rompe", () => {
    const [f] = filas("ventas", [afipRow("ventas", { "Imp. Total": { v: 1 } as unknown as string })]);
    expect(f).toMatchObject({ estado: "error", error: "Número inválido en «Imp. Total»" });
  });
});

describe("misma Clave ARCA que el .xlsx", () => {
  it.each(["ventas", "compras"] as const)("%s", (kind) => {
    const doc: Record<string, Cell> = kind === "ventas" ? { nroDocReceptor: CUIT } : { nroDocEmisor: CUIT_EMISOR };
    const excel = excelSheet(kind, { fecha: "15/10/2026", tipo: "11 - Factura C", puntoVenta: "00002", numeroDesde: "00000042", numeroHasta: 42, tipoDocReceptor: "CUIT", tipoDocEmisor: "CUIT", denominacionReceptor: "QA", denominacionEmisor: "QA", impTotal: 1000, ...doc });
    const header = findHeader(kind, excel);
    if ("error" in header) throw new Error(header.error);
    const fromExcel = buildRows(kind, excel, header, refs);
    if ("error" in fromExcel) throw new Error(fromExcel.error);
    const docArca: Record<string, string> = kind === "ventas" ? { "Nro. Doc. Receptor": CUIT } : { "Nro. Doc. Emisor": CUIT_EMISOR };
    const [fromArca] = filas(kind, [afipRow(kind, { "Punto de Venta": "2", "Número Desde": "42", ...docArca })]);
    expect(fromArca.clave).toBe(fromExcel[0].clave);
    expect(fromArca.clave).toBe(`11|2|42|${kind === "ventas" ? CUIT : CUIT_EMISOR}`);
  });
});
