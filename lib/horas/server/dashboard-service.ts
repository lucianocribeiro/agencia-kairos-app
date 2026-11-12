import "server-only";

import type { ServiceResult } from "@/lib/abm/types";
import { bucketKey, buildBuckets, GROUPINGS, todayInBuenosAires, type Grouping } from "../dates";
import { sumHours } from "../time";
import { loadHorasOptions } from "./admin-service";
import { listHorasInRange } from "./repo";
import { fail, resolveRange } from "./write";

import type { DashboardData, DashboardProject, DashboardRow } from "../types";
export type { DashboardData, DashboardProject, DashboardRow } from "../types";

/**
 * Dashboard (Admin): horas por proyecto y por período. Solo horas, nunca
 * importes. Usa recordHours (vía listHorasInRange) y sumHours, igual que la
 * lista de Horas: para el mismo filtro el total general coincide.
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

export async function loadDashboard(query: DashboardQuery, now = new Date()): Promise<ServiceResult<DashboardData>> {
  const resolved = resolveRange(query.desde, query.hasta, todayInBuenosAires(now));
  if ("error" in resolved) return fail(400, resolved.error);
  const grouping = query.agrupacion ?? "mensual";
  if (!isGrouping(grouping)) return fail(400, DASHBOARD_MESSAGES.agrupacion);
  const buckets = buildBuckets(resolved.range, grouping);
  if (grouping === "diaria" && buckets.length > MAX_DAILY_BUCKETS) return fail(400, DASHBOARD_MESSAGES.diariaLarga);
  if (query.proyectos.some((id) => !RECORD_ID_RE.test(id))) return fail(400, DASHBOARD_MESSAGES.proyectos);

  const [options, horas] = await Promise.all([loadHorasOptions(), listHorasInRange(resolved.range)]);
  const proyectos: DashboardProject[] = options.proyectos.map((p) => ({ id: p.id, codigo: p.codigo, estado: p.estado }));
  const byId = new Map(proyectos.map((p) => [p.id, p]));
  const selected = [...new Set(query.proyectos)];
  if (selected.some((id) => !byId.has(id))) return fail(400, DASHBOARD_MESSAGES.proyectos);

  const included = selected.length > 0 ? horas.filter((h) => h.proyecto && selected.includes(h.proyecto)) : horas;
  const index = new Map(buckets.map((b, i) => [b.key, i]));

  // Una fila por proyecto (null = sin proyecto). Seleccionados: aunque estén en 0.
  const rowKeys = selected.length > 0 ? selected : [...new Set(included.map((h) => h.proyecto ?? ""))];
  const rows: DashboardRow[] = rowKeys.map((key) => {
    const own = included.filter((h) => (h.proyecto ?? "") === key);
    const cells = buckets.map(() => [] as number[]);
    for (const h of own) cells[index.get(bucketKey(h.fecha!, grouping))!].push(h.horas);
    return {
      proyecto: key ? (byId.get(key) ?? { id: key, codigo: "(proyecto borrado)", estado: null }) : null,
      values: cells.map((c) => sumHours(c)),
      total: sumHours(own.map((h) => h.horas)),
    };
  });
  const visible = rows
    .filter((r) => r.total > 0 || selected.length > 0)
    .sort((a, b) => (a.proyecto?.codigo ?? "￿").localeCompare(b.proyecto?.codigo ?? "￿", "es", { numeric: true }));

  return {
    ok: true,
    data: {
      range: resolved.range,
      grouping,
      buckets,
      rows: visible,
      columnTotals: buckets.map((_, i) => sumHours(visible.map((r) => r.values[i]))),
      total: sumHours(included.map((h) => h.horas)),
      proyectos,
      selected,
    },
  };
}
