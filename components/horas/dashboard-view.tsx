"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { InlineMessage } from "@/components/ui";
import { displayDate, type DateRange, type Grouping } from "@/lib/horas/dates";
import { formatHours } from "@/lib/horas/time";
import type { DashboardData } from "@/lib/horas/types";

import { getApi, query } from "./api";
import { DashboardFilters, HoursChart, HoursTable } from "./dashboard-parts";

const estadoLabel = (estado: string | null) => estado ?? "Sin estado";

/** Dashboard (Admin): horas por proyecto × período, con barras por período. Solo horas. */
export function DashboardView({ today, initial }: { today: string; initial: DashboardData }) {
  const [range, setRange] = useState<DateRange>(initial.range);
  const [grouping, setGrouping] = useState<Grouping>(initial.grouping);
  const [selected, setSelected] = useState<string[]>(initial.selected);
  const [data, setData] = useState<DashboardData>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await getApi(`/api/admin/dashboard${query({ desde: range.desde, hasta: range.hasta, agrupacion: grouping, proyectos: selected.join(",") })}`);
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "No pudimos cargar el dashboard.");
    setError(null);
    setData(res.data as unknown as DashboardData);
  }, [range, grouping, selected]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void reload();
  }, [reload]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Dashboard</h1>

      <DashboardFilters
        today={today}
        range={range}
        onRange={setRange}
        grouping={grouping}
        onGrouping={setGrouping}
        proyectos={data.proyectos.map((p) => ({ id: p.id, label: `${p.codigo} · ${estadoLabel(p.estado)}` }))}
        selected={selected}
        onSelected={setSelected}
        allLabel="Proyectos: todos con horas"
        allButton="Todos con horas en el período"
        disabled={loading}
      />

      <p className="text-sm text-muted">
        {displayDate(data.range.desde)} al {displayDate(data.range.hasta)} · Total{" "}
        <span className="font-semibold text-white tabular-nums">{formatHours(data.total)}</span> h
      </p>
      {error && <InlineMessage tone="danger">{error}</InlineMessage>}

      <HoursChart buckets={data.buckets} columnTotals={data.columnTotals} grouping={data.grouping} />

      <HoursTable
        buckets={data.buckets}
        rows={data.rows.map((r) => ({ key: r.proyecto?.id ?? "sin-proyecto", label: r.proyecto?.codigo ?? "(sin proyecto)", values: r.values, total: r.total }))}
        columnTotals={data.columnTotals}
        total={data.total}
        loading={loading}
      />
    </div>
  );
}
