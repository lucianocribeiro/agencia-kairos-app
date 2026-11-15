/**
 * Reporte «Resultados» (hoja Resultados del Excel): Impacto en resultados por
 * categoría × mes. Puro; centavos enteros.
 */
import { indiceMes, type Periodo } from "./periodo";
import { collator, margen, type ComprobanteR, type MovimientoR } from "./types";

export interface CategoriaR {
  id: string;
  nombre: string;
  /** "Ingreso" | "Gasto" | otro. */
  tipo: string | null;
}

/** Una fila de montos por mes (12) más el total. Centavos. */
export interface FilaMeses {
  id: string | null;
  nombre: string;
  valores: number[];
  total: number;
}

export interface ResultadosData {
  periodo: Periodo;
  aviso: string | null;
  ingresos: FilaMeses[];
  totalIngresos: FilaMeses;
  gastos: FilaMeses[];
  /** «Sin categoría (revisar CONTROL)»: categoría efectiva vacía o que no es una categoría Ingreso/Gasto. */
  sinCategoria: FilaMeses;
  totalGastos: FilaMeses;
  resultado: FilaMeses;
  /** Resultado / Total ingresos, por mes y total (índice 12); null si ingresos = 0. */
  margen: (number | null)[];
}

export const SIN_CATEGORIA = "Sin categoría (revisar CONTROL)";

const vacia = (id: string | null, nombre: string): FilaMeses => ({ id, nombre, valores: Array(12).fill(0), total: 0 });

function sumar(fila: FilaMeses, i: number, cents: number) {
  fila.valores[i] += cents;
  fila.total += cents;
}

function sumaFilas(id: string | null, nombre: string, filas: FilaMeses[]): FilaMeses {
  const out = vacia(id, nombre);
  for (const f of filas) for (let i = 0; i < 12; i++) sumar(out, i, f.valores[i]);
  return out;
}

/**
 * S(X, M) = Σ Impacto de Ventas y Compras con categoría efectiva X y Mes devengado
 * efectivo M + Σ Impacto de Tesorería con categoría efectiva X y Fecha en M.
 * Ingreso → S; Gasto → −S (sin importar de qué tabla viene el registro).
 * Sin categoría → −S de los registros sin categoría (o con una que no está en la lista).
 */
export function calcularResultados(periodo: Periodo, categorias: readonly CategoriaR[], comprobantes: readonly ComprobanteR[], movimientos: readonly MovimientoR[], aviso: string | null = null): ResultadosData {
  const orden = [...categorias].sort((a, b) => collator.compare(a.nombre, b.nombre));
  const ingresos = orden.filter((c) => c.tipo === "Ingreso").map((c) => vacia(c.id, c.nombre));
  const gastos = orden.filter((c) => c.tipo === "Gasto").map((c) => vacia(c.id, c.nombre));
  const sinCategoria = vacia(null, SIN_CATEGORIA);
  const fila = new Map<string, { f: FilaMeses; signo: 1 | -1 }>([
    ...ingresos.map((f) => [f.id!, { f, signo: 1 as const }] as const),
    ...gastos.map((f) => [f.id!, { f, signo: -1 as const }] as const),
  ]);
  const imputar = (categoria: string | null, mes: string | null, impacto: number) => {
    const i = indiceMes(periodo, mes);
    if (i < 0 || impacto === 0) return;
    const destino = categoria ? fila.get(categoria) : undefined;
    if (destino) sumar(destino.f, i, destino.signo * impacto);
    else sumar(sinCategoria, i, -impacto);
  };
  for (const c of comprobantes) imputar(c.categoria, c.mes, c.impacto);
  for (const m of movimientos) if (m.suma === "S") imputar(m.categoria, m.fecha, m.impacto);

  const totalIngresos = sumaFilas(null, "Total ingresos", ingresos);
  const totalGastos = sumaFilas(null, "Total gastos", [...gastos, sinCategoria]);
  const resultado = vacia(null, "RESULTADO");
  for (let i = 0; i < 12; i++) sumar(resultado, i, totalIngresos.valores[i] - totalGastos.valores[i]);
  const margenes = [...resultado.valores.map((r, i) => margen(r, totalIngresos.valores[i])), margen(resultado.total, totalIngresos.total)];
  for (const f of [...ingresos, ...gastos, sinCategoria, totalIngresos, totalGastos, resultado]) {
    f.valores = f.valores.map((v) => v || 0);
    f.total = f.total || 0;
  }
  return { periodo, aviso, ingresos, totalIngresos, gastos, sinCategoria, totalGastos, resultado, margen: margenes };
}
