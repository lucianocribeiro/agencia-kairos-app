"use client";

import { Download } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { DashboardFilters, HoursChart, HoursTable } from "@/components/horas/dashboard-parts";
import { getApi, query } from "@/components/horas/api";
import { Tabla } from "@/components/reportes/vista-tabla";
import { InlineMessage } from "@/components/ui";
import { buttonClasses } from "@/components/ui/button";
import { CLIENTE_MESSAGES, type ClienteHorasData } from "@/lib/cliente/types";
import { tablasImportes, VISTA_CLIENTE_TITULO } from "@/lib/cliente/vista";
import { displayDate, type DateRange, type Grouping } from "@/lib/horas/dates";
import { formatHours } from "@/lib/horas/time";

const filtros = (d: Pick<ClienteHorasData, "range" | "grouping" | "selected">) =>
  query({ desde: d.range.desde, hasta: d.range.hasta, agrupacion: d.grouping, proyectos: d.selected.join(",") });

/**
 * Vista Cliente («Horas»): el dashboard de horas (mismas piezas que el de Admin) con
 * solo sus proyectos y solo horas facturables, y debajo los importes con el detalle por
 * colaborador. Solo lectura. El Excel exporta exactamente lo que se ve.
 */
export function ClienteHorasView({ today, initial, aviso }: { today: string; initial: ClienteHorasData; aviso: string | null }) {
  const [range, setRange] = useState<DateRange>(initial.range);
  const [grouping, setGrouping] = useState<Grouping>(initial.grouping);
  const [selected, setSelected] = useState<string[]>(initial.selected);
  const [data, setData] = useState<ClienteHorasData>(initial);
  const [error, setError] = useState<string | null>(aviso);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await getApi(`/api/cliente/horas${filtros({ range, grouping, selected })}`);
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "No pudimos cargar las horas.");
    setError(null);
    setData(res.data as unknown as ClienteHorasData);
  }, [range, grouping, selected]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void reload();
  }, [reload]);

  if (data.proyectos.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{VISTA_CLIENTE_TITULO}</h1>
        {aviso && aviso !== CLIENTE_MESSAGES.sinProyectos && <InlineMessage tone="danger">{aviso}</InlineMessage>}
        <InlineMessage tone="info">{CLIENTE_MESSAGES.sinProyectos}</InlineMessage>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{VISTA_CLIENTE_TITULO}</h1>
        <a href={`/api/cliente/horas/excel${filtros(data)}`} className={buttonClasses("primary", "md", "gap-2")} download aria-disabled={loading}>
          <Download aria-hidden="true" className="size-4" />
          Descargar Excel
        </a>
      </div>

      <DashboardFilters
        today={today}
        range={range}
        onRange={setRange}
        grouping={grouping}
        onGrouping={setGrouping}
        proyectos={data.proyectos.map((p) => ({ id: p.id, label: p.codigo }))}
        selected={selected}
        onSelected={setSelected}
        allLabel="Proyectos: todos"
        allButton="Todos mis proyectos"
        disabled={loading}
      />

      <p className="text-sm text-muted">
        {displayDate(data.range.desde)} al {displayDate(data.range.hasta)} · Solo horas facturables · Total{" "}
        <span className="font-semibold text-white tabular-nums">{formatHours(data.total)}</span> h
      </p>
      {error && <InlineMessage tone="danger">{error}</InlineMessage>}

      <HoursChart buckets={data.buckets} columnTotals={data.columnTotals} grouping={data.grouping} />

      <HoursTable
        buckets={data.buckets}
        rows={data.rows.map((r) => ({ key: r.proyecto.id, label: r.proyecto.codigo, values: r.values, total: r.total }))}
        columnTotals={data.columnTotals}
        total={data.total}
        loading={loading}
      />

      <div className="flex flex-col gap-6" aria-busy={loading}>
        {tablasImportes(data).map((t, i) => (
          <Tabla key={i} tabla={t} />
        ))}
      </div>
    </div>
  );
}
