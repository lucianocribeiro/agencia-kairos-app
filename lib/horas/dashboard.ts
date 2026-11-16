/**
 * Agregación del dashboard de horas: una fila por proyecto × un valor por período, con
 * totales por fila y por columna. Pura y client-safe. La usan el dashboard de Admin
 * (lib/horas/server/dashboard-service.ts) y la vista Cliente (lib/cliente/server/service.ts):
 * hay un solo dashboard. Horas con `sumHours` sobre `recordHours` (ya calculadas).
 */
import { bucketKey, type Bucket, type Grouping } from "./dates";
import { sumHours } from "./time";

export interface HoraAgregable {
  /** "YYYY-MM-DD", dentro del rango de los buckets. */
  fecha: string;
  proyecto: string | null;
  /** recordHours(desde, hasta). */
  horas: number;
}

export interface FilaAgregada<P> {
  /** null = registros sin proyecto. */
  proyecto: P | null;
  values: number[];
  total: number;
}

export interface Agregado<P> {
  rows: FilaAgregada<P>[];
  columnTotals: number[];
  total: number;
}

/**
 * - `seleccion` null: todos los proyectos con horas (solo filas con total > 0).
 * - `seleccion` con IDs: solo esos proyectos, una fila cada uno aunque esté en 0.
 * Filas ordenadas por Código (es, numérico); «sin proyecto» al final.
 */
export function agregarDashboard<P extends { codigo: string }>(input: {
  buckets: readonly Bucket[];
  grouping: Grouping;
  horas: readonly HoraAgregable[];
  seleccion: readonly string[] | null;
  /** ID de proyecto → proyecto para la fila. */
  proyecto: (id: string) => P;
}): Agregado<P> {
  const { buckets, grouping, seleccion } = input;
  const included = seleccion ? input.horas.filter((h) => h.proyecto && seleccion.includes(h.proyecto)) : input.horas;
  const index = new Map(buckets.map((b, i) => [b.key, i]));

  const rowKeys = seleccion ? [...seleccion] : [...new Set(included.map((h) => h.proyecto ?? ""))];
  const rows: FilaAgregada<P>[] = rowKeys.map((key) => {
    const own = included.filter((h) => (h.proyecto ?? "") === key);
    const cells = buckets.map(() => [] as number[]);
    for (const h of own) cells[index.get(bucketKey(h.fecha, grouping))!].push(h.horas);
    return {
      proyecto: key ? input.proyecto(key) : null,
      values: cells.map((c) => sumHours(c)),
      total: sumHours(own.map((h) => h.horas)),
    };
  });
  const visible = rows
    .filter((r) => r.total > 0 || seleccion !== null)
    .sort((a, b) => (a.proyecto?.codigo ?? "￿").localeCompare(b.proyecto?.codigo ?? "￿", "es", { numeric: true }));

  return {
    rows: visible,
    columnTotals: buckets.map((_, i) => sumHours(visible.map((r) => r.values[i]))),
    total: sumHours(included.map((h) => h.horas)),
  };
}
