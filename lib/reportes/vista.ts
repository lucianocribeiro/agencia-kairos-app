/**
 * Vista de un reporte: títulos, líneas y tablas armadas UNA vez desde el objeto de
 * resultado. La pantalla (components/reportes) y la descarga Excel (excel.ts) usan
 * esta misma vista, así muestran exactamente las mismas filas y valores. Puro.
 */
import { isoToDisplayDate } from "@/lib/format";
import { mesLabel } from "./periodo";
import type { PorProyectoData } from "./por-proyecto";
import type { FilaMeses, ResultadosData } from "./resultados";
import type { SaldosData } from "./saldos";
import { SOCIOS_MESSAGES, type SociosData } from "./socios";

/** money: centavos · pct: decimal (0,25 = 25 %) · hours: horas · text. */
export type ColumnKind = "text" | "money" | "pct" | "hours";

export interface VistaColumna {
  label: string;
  kind: ColumnKind;
}

export interface VistaFila {
  cells: (string | number | null)[];
  /** Fila de total (se resalta). */
  total?: boolean;
  /** Fila de sección («INGRESOS», «GASTOS»): solo la primera celda. */
  seccion?: boolean;
  /** Las celdas numéricas de esta fila son porcentajes (p. ej. «Margen %» en una tabla de importes). */
  pct?: boolean;
}

/** Tipo efectivo de una celda: el de la columna, salvo que la fila sea de porcentajes. */
export const kindDe = (col: VistaColumna, fila: VistaFila): ColumnKind => (fila.pct && col.kind === "money" ? "pct" : col.kind);

export interface VistaTabla {
  titulo: string | null;
  columnas: VistaColumna[];
  filas: VistaFila[];
  /** Error que reemplaza a esta tabla (sin columnas ni filas), p. ej. falta un tipo de operación. */
  error?: string | null;
}

export interface Vista {
  titulo: string;
  /** Período o fecha, debajo del título. */
  lineas: string[];
  avisos: string[];
  /** Error que reemplaza a las tablas (p. ej. falta un tipo de operación). */
  error: string | null;
  tablas: VistaTabla[];
}

const meses = (labels: string[]): VistaColumna[] => labels.map((m) => ({ label: mesLabel(m), kind: "money" as const }));
const filaMeses = (f: FilaMeses, total = false): VistaFila => ({ cells: [f.nombre, ...f.valores, f.total], total });

export function vistaResultados(d: ResultadosData): Vista {
  const cols: VistaColumna[] = [{ label: "Categoría", kind: "text" }, ...meses(d.periodo.meses), { label: "Total", kind: "money" }];
  const seccion = (nombre: string): VistaFila => ({ cells: [nombre, ...Array(13).fill(null)], seccion: true });
  return {
    titulo: "Resultados",
    lineas: [d.periodo.label],
    avisos: d.aviso ? [d.aviso] : [],
    error: null,
    tablas: [
      {
        titulo: null,
        columnas: cols,
        filas: [
          seccion("INGRESOS"),
          ...d.ingresos.map((f) => filaMeses(f)),
          filaMeses(d.totalIngresos, true),
          seccion("GASTOS"),
          ...d.gastos.map((f) => filaMeses(f)),
          filaMeses(d.sinCategoria),
          filaMeses(d.totalGastos, true),
          filaMeses(d.resultado, true),
          { cells: ["Margen %", ...d.margen], total: true, pct: true },
        ],
      },
    ],
  };
}

export function vistaPorProyecto(d: PorProyectoData): Vista {
  const res = (f: { nombre: string; ingresos: number; gastos: number; resultado: number; margen: number | null }, total = false): VistaFila => ({
    cells: [f.nombre, f.ingresos, f.gastos, f.resultado, f.margen],
    total,
  });
  return {
    titulo: "Resultados por unidad de negocio y por proyecto",
    lineas: [d.periodo.label],
    avisos: d.aviso ? [d.aviso] : [],
    error: null,
    tablas: [
      {
        titulo: "Por unidad de negocio",
        columnas: [
          { label: "Unidad de negocio", kind: "text" },
          { label: "Ingresos $", kind: "money" },
          { label: "Gastos $", kind: "money" },
          { label: "Resultado $", kind: "money" },
          { label: "Margen %", kind: "pct" },
        ],
        filas: [...d.unidades.map((f) => res(f)), res(d.sinUnidad), res(d.tesoreria), res(d.totalUnidades, true)],
      },
      {
        titulo: "Por proyecto",
        columnas: [
          { label: "Proyecto", kind: "text" },
          { label: "Ingresos $", kind: "money" },
          { label: "Gastos $", kind: "money" },
          { label: "Resultado $", kind: "money" },
          { label: "Margen %", kind: "pct" },
          { label: "Cliente", kind: "text" },
          { label: "Unidad de negocio", kind: "text" },
          { label: "Horas trabajadas", kind: "hours" },
          { label: "Ingreso por hora $", kind: "money" },
        ],
        filas: [...d.proyectos, d.sinProyecto].map((p) => ({
          cells: [p.nombre, p.ingresos, p.gastos, p.resultado, p.margen, p.cliente, p.unidadNegocio, p.horas, p.ingresoPorHora],
        })),
      },
    ],
  };
}

export function vistaSocios(d: SociosData): Vista {
  const base = { titulo: "Socios", lineas: [d.periodo.label], avisos: d.aviso ? [d.aviso] : [] };
  if (!d.ok) return { ...base, error: SOCIOS_MESSAGES.faltanTipos(d.faltan), tablas: [] };
  const t = d.total;
  return {
    ...base,
    error: null,
    tablas: [
      {
        titulo: "Histórico (todas las fechas)",
        columnas: [
          { label: "Socio", kind: "text" },
          { label: "Retiros $", kind: "money" },
          { label: "Gastos particulares (Tesorería) $", kind: "money" },
          { label: "Gastos particulares (Compras, neto) $", kind: "money" },
          { label: "Aportes $", kind: "money" },
          { label: "Total retirado neto $", kind: "money" },
          { label: "% que le corresponde", kind: "pct" },
          { label: "Le corresponde $", kind: "money" },
          { label: "Diferencia $", kind: "money" },
          { label: "Situación", kind: "text" },
        ],
        filas: [
          ...d.socios.map((s) => ({
            cells: [s.sigla, s.retiros, s.gastosTesoreria, s.gastosCompras, s.aportes, s.totalNeto, s.porcentaje, s.leCorresponde, s.diferencia, s.situacion],
          })),
          { cells: ["Total", t.retiros, t.gastosTesoreria, t.gastosCompras, t.aportes, t.totalNeto, null, t.leCorresponde, null, null], total: true },
        ],
      },
      {
        titulo: "Total retirado neto por mes",
        columnas: [{ label: "Socio", kind: "text" }, ...meses(d.periodo.meses), { label: "Total", kind: "money" }],
        filas: d.porMes.map((s) => ({ cells: [s.sigla, ...s.valores, s.total] })),
      },
    ],
  };
}

export function vistaSaldos(d: SaldosData): Vista {
  const clientes: VistaTabla = d.clientes
    ? {
        titulo: "Clientes",
        columnas: [
          { label: "Cliente", kind: "text" },
          { label: "Sigla", kind: "text" },
          { label: "Facturado $", kind: "money" },
          { label: "Cobrado $", kind: "money" },
          { label: "Saldo a cobrar $", kind: "money" },
        ],
        filas: [
          ...d.clientes.map((c) => ({ cells: [c.nombre, c.sigla, c.facturado, c.cobrado, c.saldo] })),
          { cells: ["Ventas sin cliente identificado", null, d.ventasSinCliente, null, null], total: true },
        ],
      }
    : { titulo: "Clientes", columnas: [], filas: [], error: d.errorClientes };
  const proveedores: VistaTabla = d.proveedores
    ? {
        titulo: "Proveedores",
        columnas: [
          { label: "Proveedor", kind: "text" },
          { label: "Facturado $", kind: "money" },
          { label: "Pagado $", kind: "money" },
          { label: "Saldo a pagar $", kind: "money" },
        ],
        filas: d.proveedores.map((p) => ({ cells: [p.nombre, p.facturado, p.pagado, p.saldo] })),
      }
    : { titulo: "Proveedores", columnas: [], filas: [], error: d.errorProveedores };
  return {
    titulo: "Saldos",
    lineas: [`Histórico al ${isoToDisplayDate(d.hoy)}`],
    avisos: [],
    error: null,
    tablas: [
      {
        titulo: "Cuentas (en la moneda de cada cuenta)",
        columnas: [
          { label: "Cuenta", kind: "text" },
          { label: "Moneda", kind: "text" },
          { label: "Saldo inicial", kind: "money" },
          { label: "Entradas", kind: "money" },
          { label: "Salidas", kind: "money" },
          { label: "Saldo actual", kind: "money" },
        ],
        filas: d.cuentas.map((c) => ({ cells: [c.nombre, c.moneda, c.saldoInicial, c.entradas, c.salidas, c.saldoActual] })),
      },
      clientes,
      proveedores,
    ],
  };
}
