"use client";

import { Download } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Tabla } from "@/components/reportes/vista-tabla";
import { FormField, InlineMessage, Select } from "@/components/ui";
import { buttonClasses } from "@/components/ui/button";
import { tablasImportes } from "@/lib/cliente/vista";
import { DASHBOARD_ADMIN_MESSAGES, SIN_PROYECTO_LABEL, type DashboardAdminData } from "@/lib/horas/dashboard-admin";
import { displayDate, type DateRange, type Grouping } from "@/lib/horas/dates";
import { ESTADOS_FACTURACION, isEstadoFacturacion, type EstadoFacturacion } from "@/lib/horas/estado";
import { formatHours } from "@/lib/horas/time";

import { getApi, query } from "./api";
import { DashboardFilters, HoursChart, HoursTable } from "./dashboard-parts";

const estadoLabel = (estado: string | null) => estado ?? "Sin estado";

const filtros = (f: { range: DateRange; grouping: Grouping; selected: readonly string[]; cliente: string | null; estado: EstadoFacturacion | null }) =>
  query({ desde: f.range.desde, hasta: f.range.hasta, agrupacion: f.grouping, proyectos: f.selected.join(","), cliente: f.cliente ?? "", estado: f.estado ?? "" });

/**
 * Dashboard (Admin): horas por proyecto × período (todas, facturables o no) y, debajo, los
 * mismos importes que ve el Cliente (CC-F4-11). Filtros Cliente y Estado de facturación para
 * toda la pantalla; el Excel exporta exactamente lo que se ve.
 */
export function DashboardView({ today, initial }: { today: string; initial: DashboardAdminData }) {
  const [range, setRange] = useState<DateRange>(initial.range);
  const [grouping, setGrouping] = useState<Grouping>(initial.grouping);
  const [selected, setSelected] = useState<string[]>(initial.selected);
  const [cliente, setCliente] = useState<string | null>(initial.cliente);
  const [estado, setEstado] = useState<EstadoFacturacion | null>(initial.estado);
  const [data, setData] = useState<DashboardAdminData>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await getApi(`/api/admin/dashboard/vista${filtros({ range, grouping, selected, cliente, estado })}`);
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "No pudimos cargar el dashboard.");
    setError(null);
    setData(res.data as unknown as DashboardAdminData);
  }, [range, grouping, selected, cliente, estado]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void reload();
  }, [reload]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-strong">{DASHBOARD_ADMIN_MESSAGES.titulo}</h1>
        <a href={`/api/admin/dashboard/excel${filtros(data)}`} className={buttonClasses("primary", "md", "gap-2")} download aria-disabled={loading}>
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
        proyectos={data.proyectos.map((p) => ({ id: p.id, label: `${p.codigo} · ${estadoLabel(p.estado)}` }))}
        selected={selected}
        onSelected={setSelected}
        allLabel="Proyectos: todos con horas"
        allButton="Todos con horas en el período"
        disabled={loading}
      />

      <div className="flex flex-col gap-4 sm:flex-row">
        <FormField label="Cliente" className="sm:w-72">
          <Select
            value={cliente ?? ""}
            onChange={(e) => {
              // Otro cliente: el filtro de proyectos se vacía (la lista cambia).
              setSelected([]);
              setCliente(e.target.value || null);
            }}
            placeholder="Todos"
            options={data.clientes.map((c) => ({ value: c.id, label: c.nombre }))}
            disabled={loading}
          />
        </FormField>
        <FormField label="Estado de facturación" className="sm:w-64">
          <Select
            value={estado ?? ""}
            onChange={(e) => setEstado(isEstadoFacturacion(e.target.value) ? e.target.value : null)}
            placeholder="Todos"
            options={ESTADOS_FACTURACION.map((v) => ({ value: v, label: v }))}
            disabled={loading}
          />
        </FormField>
      </div>

      <p className="text-sm text-muted">
        {displayDate(data.range.desde)} al {displayDate(data.range.hasta)} · Estado: {data.estado ?? "Todos"} · Total{" "}
        <span className="font-semibold text-strong tabular-nums">{formatHours(data.total)}</span> h
      </p>
      {error && <InlineMessage tone="danger">{error}</InlineMessage>}

      <HoursChart buckets={data.buckets} columnTotals={data.columnTotals} grouping={data.grouping} />

      <HoursTable
        buckets={data.buckets}
        rows={data.rows.map((r) => ({ key: r.proyecto?.id ?? "sin-proyecto", label: r.proyecto?.codigo ?? SIN_PROYECTO_LABEL, values: r.values, total: r.total }))}
        columnTotals={data.columnTotals}
        total={data.total}
        loading={loading}
      />

      <section aria-labelledby="importes-titulo" className="flex flex-col gap-4" aria-busy={loading}>
        <div className="flex flex-col gap-1">
          <h2 id="importes-titulo" className="text-lg font-semibold text-strong">
            Importes
          </h2>
          <p className="text-sm text-muted">{DASHBOARD_ADMIN_MESSAGES.soloFacturables}</p>
        </div>
        {tablasImportes(data).map((t, i) => (
          <Tabla key={i} tabla={t} />
        ))}
      </section>
    </div>
  );
}
