"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Checkbox, FormField, InlineMessage, Select } from "@/components/ui";
import { buttonClasses } from "@/components/ui/button";
import { displayDate, GROUPINGS, type DateRange, type Grouping } from "@/lib/horas/dates";
import { formatHours } from "@/lib/horas/time";
import type { DashboardData } from "@/lib/horas/types";

import { getApi, query } from "./api";
import { HoursBarChart } from "./hours-bar-chart";
import { PeriodFilter } from "./period-filter";

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

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const bars = data.buckets.map((b, i) => ({ key: b.key, label: b.label, value: data.columnTotals[i] ?? 0 }));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Dashboard</h1>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <PeriodFilter value={range} onChange={setRange} today={today} shortcuts={["mesActual", "mesAnterior", "trimestreActual", "anioActual"]} disabled={loading} />
        <FormField label="Agrupación" className="sm:w-48">
          <Select value={grouping} onChange={(e) => setGrouping(e.target.value as Grouping)} options={Object.entries(GROUPINGS).map(([value, label]) => ({ value, label }))} />
        </FormField>
        <details className="group relative sm:w-72">
          <summary className={buttonClasses("secondary", "md", "w-full cursor-pointer list-none justify-between [&::-webkit-details-marker]:hidden")}>
            <span>{selected.length === 0 ? "Proyectos: todos con horas" : `Proyectos: ${selected.length} elegidos`}</span>
            <ChevronDown aria-hidden="true" className="size-4 transition group-open:rotate-180" />
          </summary>
          <div className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-line bg-card p-2 shadow-lg">
            <button type="button" className={buttonClasses("ghost", "sm", "mb-1 w-full justify-start")} onClick={() => setSelected([])} disabled={selected.length === 0}>
              Todos con horas en el período
            </button>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="sr-only">Proyectos</legend>
              {data.proyectos.map((p) => (
                <Checkbox key={p.id} checked={selected.includes(p.id)} onChange={() => toggle(p.id)} label={`${p.codigo} · ${estadoLabel(p.estado)}`} />
              ))}
            </fieldset>
          </div>
        </details>
      </div>

      <p className="text-sm text-muted">
        {displayDate(data.range.desde)} al {displayDate(data.range.hasta)} · Total{" "}
        <span className="font-semibold text-white tabular-nums">{formatHours(data.total)}</span> h
      </p>
      {error && <InlineMessage tone="danger">{error}</InlineMessage>}

      <HoursBarChart data={bars} title={`Horas por período (${GROUPINGS[data.grouping].toLowerCase()})`} />

      <div className="w-full overflow-x-auto rounded-lg border border-line" aria-busy={loading}>
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Horas por proyecto y por período</caption>
          <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-3 font-medium">
                Proyecto
              </th>
              {data.buckets.map((b) => (
                <th key={b.key} scope="col" className="px-3 py-3 text-right font-medium whitespace-nowrap">
                  {b.label}
                </th>
              ))}
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-card">
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={data.buckets.length + 2} className="px-4 py-8 text-center text-muted">
                  No hay horas en este período.
                </td>
              </tr>
            ) : (
              data.rows.map((r) => (
                <tr key={r.proyecto?.id ?? "sin-proyecto"}>
                  <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2 font-medium whitespace-nowrap text-text">
                    {r.proyecto?.codigo ?? "(sin proyecto)"}
                  </th>
                  {r.values.map((v, i) => (
                    <td key={data.buckets[i].key} className="px-3 py-2 text-right tabular-nums text-muted">
                      {v > 0 ? <span className="text-text">{formatHours(v)}</span> : formatHours(0)}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-white">{formatHours(r.total)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="bg-surface">
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left font-medium text-muted">
                Total
              </th>
              {data.columnTotals.map((v, i) => (
                <td key={data.buckets[i].key} className="px-3 py-3 text-right font-medium tabular-nums text-text">
                  {formatHours(v)}
                </td>
              ))}
              <td className="px-4 py-3 text-right font-semibold tabular-nums text-accent">{formatHours(data.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
