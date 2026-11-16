import "server-only";

import type { ServiceResult } from "@/lib/abm/types";
import { agregarDashboard } from "../dashboard";
import { buildBuckets, GROUPINGS, todayInBuenosAires, type Bucket, type DateRange, type Grouping } from "../dates";
import { loadHorasOptions } from "./admin-service";
import { listHorasInRange } from "./repo";
import { fail, resolveRange } from "./write";

import type { DashboardData, DashboardProject } from "../types";
export type { DashboardData, DashboardProject, DashboardRow } from "../types";

/**
 * Dashboard (Admin): horas por proyecto y por período. Solo horas, nunca
 * importes. Usa recordHours (vía listHorasInRange) y sumHours, igual que la
 * lista de Horas: para el mismo filtro el total general coincide. La agregación
 * es lib/horas/dashboard.ts (la misma de la vista Cliente).
 */

export const DASHBOARD_MESSAGES = {
  agrupacion: "Elegí una agrupación válida.",
  proyectos: "Hay proyectos que no existen en el filtro.",
  diariaLarga: "Para la vista diaria elegí un período de hasta 400 días.",
} as const;
const MAX_DAILY_BUCKETS = 400;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
export const SIN_PROYECTO = "(sin proyecto)";




export interface DashboardQuery {
  desde: string | null;
  hasta: string | null;
  agrupacion: string | null;
  proyectos: string[];
}

export function isGrouping(value: unknown): value is Grouping {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(GROUPINGS, value);
}

/** Período, agrupación y proyectos del pedido (sin leer la base). Compartido con la vista Cliente. */
export function validarDashboardQuery(
  query: DashboardQuery,
  now = new Date(),
): ServiceResult<{ range: DateRange; grouping: Grouping; buckets: Bucket[]; selected: string[] }> {
  const resolved = resolveRange(query.desde, query.hasta, todayInBuenosAires(now));
  if ("error" in resolved) return fail(400, resolved.error);
  const grouping = query.agrupacion ?? "mensual";
  if (!isGrouping(grouping)) return fail(400, DASHBOARD_MESSAGES.agrupacion);
  const buckets = buildBuckets(resolved.range, grouping);
  if (grouping === "diaria" && buckets.length > MAX_DAILY_BUCKETS) return fail(400, DASHBOARD_MESSAGES.diariaLarga);
  if (query.proyectos.some((id) => !RECORD_ID_RE.test(id))) return fail(400, DASHBOARD_MESSAGES.proyectos);
  return { ok: true, data: { range: resolved.range, grouping, buckets, selected: [...new Set(query.proyectos)] } };
}

export async function loadDashboard(query: DashboardQuery, now = new Date()): Promise<ServiceResult<DashboardData>> {
  const q = validarDashboardQuery(query, now);
  if (!q.ok) return q;
  const { range, grouping, buckets, selected } = q.data;

  const [options, horas] = await Promise.all([loadHorasOptions(), listHorasInRange(range)]);
  const proyectos: DashboardProject[] = options.proyectos.map((p) => ({ id: p.id, codigo: p.codigo, estado: p.estado }));
  const byId = new Map(proyectos.map((p) => [p.id, p]));
  if (selected.some((id) => !byId.has(id))) return fail(400, DASHBOARD_MESSAGES.proyectos);

  const agregado = agregarDashboard({
    buckets,
    grouping,
    horas: horas.map((h) => ({ fecha: h.fecha!, proyecto: h.proyecto, horas: h.horas })),
    seleccion: selected.length > 0 ? selected : null,
    proyecto: (id) => byId.get(id) ?? { id, codigo: "(proyecto borrado)", estado: null },
  });

  return {
    ok: true,
    data: {
      range,
      grouping,
      buckets,
      rows: agregado.rows,
      columnTotals: agregado.columnTotals,
      total: agregado.total,
      proyectos,
      selected,
    },
  };
}
