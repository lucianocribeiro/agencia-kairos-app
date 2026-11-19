"use client";

import { ChevronDown } from "lucide-react";

import { Checkbox, FormField, Select } from "@/components/ui";
import { buttonClasses } from "@/components/ui/button";
import { GROUPINGS, type DateRange, type Grouping } from "@/lib/horas/dates";
import { formatHours } from "@/lib/horas/time";

import { HoursBarChart } from "./hours-bar-chart";
import { PeriodFilter } from "./period-filter";

/**
 * Piezas del dashboard de horas, compartidas por el dashboard de Admin y la vista
 * Cliente: filtros (período con atajos, agrupación, proyectos), barras por período y
 * tabla proyectos × períodos con totales por fila y por columna.
 */

export interface ProyectoFiltro {
  id: string;
  label: string;
}

export function DashboardFilters({
  today,
  range,
  onRange,
  grouping,
  onGrouping,
  proyectos,
  selected,
  onSelected,
  allLabel,
  allButton,
  disabled,
}: {
  today: string;
  range: DateRange;
  onRange: (r: DateRange) => void;
  grouping: Grouping;
  onGrouping: (g: Grouping) => void;
  proyectos: readonly ProyectoFiltro[];
  selected: readonly string[];
  onSelected: (ids: string[]) => void;
  /** Texto del botón con nada elegido («Proyectos: todos con horas»). */
  allLabel: string;
  /** Opción para volver a «todos». */
  allButton: string;
  disabled?: boolean;
}) {
  const toggle = (id: string) => onSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <PeriodFilter value={range} onChange={onRange} today={today} shortcuts={["mesActual", "mesAnterior", "trimestreActual", "anioActual"]} disabled={disabled} />
      <FormField label="Agrupación" className="sm:w-48">
        <Select value={grouping} onChange={(e) => onGrouping(e.target.value as Grouping)} options={Object.entries(GROUPINGS).map(([value, label]) => ({ value, label }))} />
      </FormField>
      <details className="group relative sm:w-72">
        <summary className={buttonClasses("secondary", "md", "w-full cursor-pointer list-none justify-between [&::-webkit-details-marker]:hidden")}>
          <span>{selected.length === 0 ? allLabel : `Proyectos: ${selected.length} elegidos`}</span>
          <ChevronDown aria-hidden="true" className="size-4 transition group-open:rotate-180" />
        </summary>
        <div className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-line bg-card p-2 shadow-lg">
          <button type="button" className={buttonClasses("ghost", "sm", "mb-1 w-full justify-start")} onClick={() => onSelected([])} disabled={selected.length === 0}>
            {allButton}
          </button>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="sr-only">Proyectos</legend>
            {proyectos.map((p) => (
              <Checkbox key={p.id} checked={selected.includes(p.id)} onChange={() => toggle(p.id)} label={p.label} />
            ))}
          </fieldset>
        </div>
      </details>
    </div>
  );
}

export interface HoursTableRow {
  key: string;
  label: string;
  values: number[];
  total: number;
}

export function HoursChart({ buckets, columnTotals, grouping }: { buckets: readonly { key: string; label: string }[]; columnTotals: readonly number[]; grouping: Grouping }) {
  const bars = buckets.map((b, i) => ({ key: b.key, label: b.label, value: columnTotals[i] ?? 0 }));
  return <HoursBarChart data={bars} title={`Horas por período (${GROUPINGS[grouping].toLowerCase()})`} />;
}

export function HoursTable({
  buckets,
  rows,
  columnTotals,
  total,
  loading,
}: {
  buckets: readonly { key: string; label: string }[];
  rows: readonly HoursTableRow[];
  columnTotals: readonly number[];
  total: number;
  loading?: boolean;
}) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-line" aria-busy={loading}>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Horas por proyecto y por período</caption>
        <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-3 font-medium">
              Proyecto
            </th>
            {buckets.map((b) => (
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
          {rows.length === 0 ? (
            <tr>
              <td colSpan={buckets.length + 2} className="px-4 py-8 text-center text-muted">
                No hay horas en este período.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2 font-medium whitespace-nowrap text-text">
                  {r.label}
                </th>
                {r.values.map((v, i) => (
                  <td key={buckets[i].key} className="px-3 py-2 text-right tabular-nums text-muted">
                    {v > 0 ? <span className="text-text">{formatHours(v)}</span> : formatHours(0)}
                  </td>
                ))}
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-strong">{formatHours(r.total)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot className="bg-surface">
          <tr>
            <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left font-medium text-muted">
              Total
            </th>
            {columnTotals.map((v, i) => (
              <td key={buckets[i].key} className="px-3 py-3 text-right font-medium tabular-nums text-text">
                {formatHours(v)}
              </td>
            ))}
            <td className="px-4 py-3 text-right font-semibold tabular-nums text-accent-text">{formatHours(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
