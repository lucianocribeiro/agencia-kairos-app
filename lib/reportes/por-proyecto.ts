/**
 * Reporte «Resultados por unidad de negocio y por proyecto» (hoja Resultados por
 * proyecto del Excel). Puro; centavos enteros. Mes: Mes devengado efectivo en
 * Ventas/Compras, Fecha en Tesorería y Horas.
 */
import { sumHours } from "@/lib/horas/time";
import { toCents } from "@/lib/ventas-compras/money";
import { indiceMes, type Periodo } from "./periodo";
import { collator, margen, type ComprobanteR, type HoraR, type MovimientoR, type RefR } from "./types";

export interface FilaResultado {
  id: string | null;
  nombre: string;
  /** Centavos. */
  ingresos: number;
  gastos: number;
  resultado: number;
  margen: number | null;
}

export interface FilaProyecto extends FilaResultado {
  cliente: string | null;
  unidadNegocio: string | null;
  /** Horas (2 decimales); null en «Sin proyecto». */
  horas: number | null;
  /** Centavos por hora; null si horas = 0. */
  ingresoPorHora: number | null;
}

export interface ProyectoR {
  id: string;
  codigo: string;
  cliente: string | null;
  unidadNegocio: string | null;
}

export interface PorProyectoData {
  periodo: Periodo;
  aviso: string | null;
  unidades: FilaResultado[];
  sinUnidad: FilaResultado;
  tesoreria: FilaResultado;
  totalUnidades: FilaResultado;
  proyectos: FilaProyecto[];
  sinProyecto: FilaProyecto;
}

export const SIN_UNIDAD = "Sin unidad de negocio";
export const TESORERIA_SIN_COMPROBANTE = "Tesorería (sin comprobante)";
export const SIN_PROYECTO = "Sin proyecto";

function cerrar<T extends FilaResultado>(f: T): T {
  f.ingresos ||= 0;
  f.gastos ||= 0;
  f.resultado = f.ingresos - f.gastos || 0;
  f.margen = margen(f.resultado, f.ingresos);
  return f;
}

const fila = (id: string | null, nombre: string): FilaResultado => ({ id, nombre, ingresos: 0, gastos: 0, resultado: 0, margen: null });

/** Ingresos += Impacto de Ventas; Gastos += −Impacto de Compras. */
function acumular(f: FilaResultado, c: ComprobanteR) {
  if (c.kind === "ventas") f.ingresos += c.impacto;
  else f.gastos -= c.impacto;
}

export function calcularPorProyecto(
  periodo: Periodo,
  refs: { unidades: readonly RefR[]; proyectos: readonly ProyectoR[]; clientes: readonly RefR[] },
  comprobantes: readonly ComprobanteR[],
  movimientos: readonly MovimientoR[],
  horas: readonly HoraR[],
  aviso: string | null = null,
): PorProyectoData {
  const enPeriodo = comprobantes.filter((c) => indiceMes(periodo, c.mes) >= 0);

  // Por unidad de negocio
  const unidades = [...refs.unidades].sort((a, b) => collator.compare(a.nombre, b.nombre)).map((u) => fila(u.id, u.nombre));
  const porUn = new Map(unidades.map((f) => [f.id!, f]));
  const sinUnidad = fila(null, SIN_UNIDAD);
  for (const c of enPeriodo) acumular((c.unidadNegocio && porUn.get(c.unidadNegocio)) || sinUnidad, c);
  const tesoreria = fila(null, TESORERIA_SIN_COMPROBANTE);
  for (const m of movimientos) {
    if (indiceMes(periodo, m.fecha) < 0) continue;
    if (m.impacto > 0) tesoreria.ingresos += m.impacto;
    else tesoreria.gastos -= m.impacto;
  }
  const filasUn = [...unidades, sinUnidad, tesoreria].map(cerrar);
  const totalUnidades = fila(null, "TOTAL");
  for (const f of filasUn) {
    totalUnidades.ingresos += f.ingresos;
    totalUnidades.gastos += f.gastos;
  }

  // Por proyecto (todos los estados, por Código)
  const nombreDe = (list: readonly RefR[], id: string | null) => (id ? (list.find((x) => x.id === id)?.nombre ?? null) : null);
  const proyectos: FilaProyecto[] = [...refs.proyectos]
    .sort((a, b) => collator.compare(a.codigo, b.codigo))
    .map((p) => ({ ...fila(p.id, p.codigo), cliente: nombreDe(refs.clientes, p.cliente), unidadNegocio: nombreDe(refs.unidades, p.unidadNegocio), horas: 0, ingresoPorHora: null }));
  const porProyecto = new Map(proyectos.map((f) => [f.id!, f]));
  const sinProyecto: FilaProyecto = { ...fila(null, SIN_PROYECTO), cliente: null, unidadNegocio: null, horas: null, ingresoPorHora: null };
  for (const c of enPeriodo) acumular((c.proyecto && porProyecto.get(c.proyecto)) || sinProyecto, c);
  const horasDe = new Map<string, number[]>();
  for (const h of horas) {
    if (!h.proyecto || indiceMes(periodo, h.fecha) < 0) continue;
    horasDe.set(h.proyecto, [...(horasDe.get(h.proyecto) ?? []), h.horas]);
  }
  for (const p of proyectos) {
    cerrar(p);
    p.horas = sumHours(horasDe.get(p.id!) ?? []);
    p.ingresoPorHora = p.horas > 0 ? toCents(p.ingresos / 100 / p.horas) : null;
  }
  cerrar(sinProyecto);

  return { periodo, aviso, unidades: filasUn.slice(0, unidades.length), sinUnidad: filasUn[unidades.length], tesoreria: filasUn[unidades.length + 1], totalUnidades: cerrar(totalUnidades), proyectos, sinProyecto };
}
