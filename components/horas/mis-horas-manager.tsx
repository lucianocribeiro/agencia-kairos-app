"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { callApi } from "@/components/abm/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  InlineMessage,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  useToast,
} from "@/components/ui";
import { controlClasses } from "@/components/ui/control-classes";
import type { FieldErrors } from "@/lib/abm/fields";
import { cn } from "@/lib/cn";
import { displayDate, type DateRange } from "@/lib/horas/dates";
import { HORA_MESSAGES, TAREA_MAX, validateHora } from "@/lib/horas/rules";
import { formatHours, parseTime, recordHours } from "@/lib/horas/time";
import type { MiHoraDTO, MisHorasData, ProyectoRef } from "@/lib/horas/types";

import { getApi, query } from "./api";
import { PeriodFilter } from "./period-filter";

export const SIN_PROYECTOS = "Todavía no tenés proyectos asignados. Pedíselo a un administrador.";

interface Props {
  /** Hoy en Buenos Aires (servidor). */
  today: string;
  /** Asignados y Activos: los que se pueden cargar. */
  proyectos: ProyectoRef[];
  /** Todos los asignados: el filtro de la lista. */
  filtros: ProyectoRef[];
  initial: MisHorasData;
}

const emptyForm = (today: string) => ({ fecha: today, proyecto: "", tarea: "", desde: "", hasta: "" });

/** Mis horas: carga (arriba) y lista propia con filtros (abajo). Sin edición ni borrado. */
export function MisHorasManager({ today, proyectos, filtros, initial }: Props) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({ ...emptyForm(today), proyecto: proyectos.length === 1 ? proyectos[0].id : "" }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [range, setRange] = useState<DateRange>(initial.range);
  const [proyectoFiltro, setProyectoFiltro] = useState("");
  const [list, setList] = useState<{ records: MiHoraDTO[]; total: number }>({ records: initial.records, total: initial.total });
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await getApi(`/api/me/horas${query({ desde: range.desde, hasta: range.hasta, proyecto: proyectoFiltro })}`);
    setLoading(false);
    if (!res.ok) return setListError(res.error ?? "No pudimos cargar tus horas.");
    setListError(null);
    setList({ records: res.data.records as MiHoraDTO[], total: res.data.total as number });
  }, [range, proyectoFiltro]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void reload();
  }, [reload]);

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const live = recordHours(parseTime(form.desde), parseTime(form.hasta));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { errors: local } = validateHora(form, "empleado");
    if (!local.fecha && form.fecha > today) local.fecha = HORA_MESSAGES.futura;
    if (Object.keys(local).length > 0) {
      setErrors(local);
      setFormError(HORA_MESSAGES.validacion);
      return;
    }
    setSaving(true);
    const res = await callApi("POST", "/api/me/horas", form);
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      setFormError(res.error ?? "Ocurrió un error. Probá de nuevo.");
      return;
    }
    setErrors({});
    setFormError(null);
    toast.success("Horas guardadas.");
    setForm((f) => ({ ...f, tarea: "", desde: f.hasta, hasta: "" }));
    void reload();
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Mis horas</h1>

      {proyectos.length === 0 ? (
        <InlineMessage tone="info">{SIN_PROYECTOS}</InlineMessage>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Cargar horas</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              {formError && <InlineMessage tone="danger">{formError}</InlineMessage>}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="Fecha" required error={errors.fecha}>
                  <Input type="date" value={form.fecha} max={today} onChange={(e) => set("fecha")(e.target.value)} disabled={saving} />
                </FormField>
                <FormField label="Proyecto" required error={errors.proyecto}>
                  <Select
                    value={form.proyecto}
                    onChange={(e) => set("proyecto")(e.target.value)}
                    placeholder="Elegí un proyecto"
                    options={proyectos.map((p) => ({ value: p.id, label: p.codigo }))}
                    disabled={saving}
                  />
                </FormField>
                <FormField label="Desde" required error={errors.desde}>
                  <Input type="time" step={60} value={form.desde} onChange={(e) => set("desde")(e.target.value)} disabled={saving} />
                </FormField>
                <FormField label="Hasta" required error={errors.hasta}>
                  <Input type="time" step={60} value={form.hasta} onChange={(e) => set("hasta")(e.target.value)} disabled={saving} />
                </FormField>
                <FormField label="Tarea" required error={errors.tarea} id="mis-horas-tarea" className="sm:col-span-2 lg:col-span-4">
                  <textarea
                    id="mis-horas-tarea"
                    value={form.tarea}
                    maxLength={TAREA_MAX}
                    rows={2}
                    onChange={(e) => set("tarea")(e.target.value)}
                    disabled={saving}
                    aria-invalid={errors.tarea ? true : undefined}
                    className={cn(controlClasses, "h-auto min-h-16 py-2")}
                  />
                </FormField>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Button type="submit" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar"}
                </Button>
                <p className="text-sm text-muted" aria-live="polite">
                  Horas: <span className="font-medium text-text tabular-nums">{formatHours(live)}</span>
                </p>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="mis-horas-lista" className="flex flex-col gap-3">
        <h2 id="mis-horas-lista" className="text-lg font-semibold text-white">
          Registros
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <PeriodFilter value={range} onChange={setRange} today={today} shortcuts={["mesActual", "mesAnterior"]} disabled={loading} />
          <FormField label="Proyecto" className="sm:w-56">
            <Select value={proyectoFiltro} onChange={(e) => setProyectoFiltro(e.target.value)} placeholder="Todos" options={filtros.map((p) => ({ value: p.id, label: p.codigo }))} />
          </FormField>
        </div>
        {listError && <InlineMessage tone="danger">{listError}</InlineMessage>}
        <Table aria-busy={loading}>
          <TableHead>
            <tr>
              <TableHeaderCell>Fecha</TableHeaderCell>
              <TableHeaderCell>Proyecto</TableHeaderCell>
              <TableHeaderCell>Tarea</TableHeaderCell>
              <TableHeaderCell>Desde</TableHeaderCell>
              <TableHeaderCell>Hasta</TableHeaderCell>
              <TableHeaderCell className="text-right">Horas</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {list.records.length === 0 ? (
              <TableEmpty colSpan={6}>No hay horas cargadas en este período.</TableEmpty>
            ) : (
              list.records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{displayDate(r.fecha)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.proyecto.codigo}</TableCell>
                  <TableCell className="max-w-md">{r.tarea}</TableCell>
                  <TableCell className="tabular-nums">{r.desde}</TableCell>
                  <TableCell className="tabular-nums">{r.hasta}</TableCell>
                  <TableCell numeric>{formatHours(r.horas)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          <tfoot className="bg-surface">
            <tr>
              <th scope="row" colSpan={5} className="px-4 py-3 text-right font-medium text-muted">
                Total
              </th>
              <td className="px-4 py-3 text-right font-semibold text-white tabular-nums">{formatHours(list.total)}</td>
            </tr>
          </tfoot>
        </Table>
      </section>
    </div>
  );
}
