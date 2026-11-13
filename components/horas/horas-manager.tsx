"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { callApi } from "@/components/abm/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
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
import { displayDate, displayMonth, type DateRange } from "@/lib/horas/dates";
import { HORA_MESSAGES, TAREA_MAX, validateHora } from "@/lib/horas/rules";
import { formatHours, parseTime, recordHours } from "@/lib/horas/time";
import type { HoraAdminDTO, HorasAdminData, HorasOptions } from "@/lib/horas/types";

import { getApi, query } from "./api";
import { PeriodFilter } from "./period-filter";

type Editing = { mode: "create" } | { mode: "edit"; record: HoraAdminDTO };

interface FormState {
  colaborador: string;
  proyecto: string;
  fecha: string;
  tarea: string;
  desde: string;
  hasta: string;
  facturable: boolean;
  /** "YYYY-MM" (input month) o "". */
  mesAFacturar: string;
}

const proyectoLabel = (p: { codigo: string; estado: string | null }) => (p.estado === "Cerrado" ? `${p.codigo} · Cerrado` : p.codigo);

/** Horas (Admin): filtros, lista con total, alta, edición y borrado. */
export function HorasManager({ today, options, initial }: { today: string; options: HorasOptions; initial: HorasAdminData }) {
  const toast = useToast();
  const [range, setRange] = useState<DateRange>(initial.range);
  const [filters, setFilters] = useState({ colaborador: "", proyecto: "", cliente: "" });
  const [list, setList] = useState({ records: initial.records, total: initial.total });
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await getApi(`/api/admin/horas${query({ desde: range.desde, hasta: range.hasta, ...filters })}`);
    setLoading(false);
    if (!res.ok) return setListError(res.error ?? "No pudimos cargar las horas.");
    setListError(null);
    setList({ records: res.data.records as HoraAdminDTO[], total: res.data.total as number });
  }, [range, filters]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void reload();
  }, [reload]);

  function open(target: Editing) {
    setEditing(target);
    setErrors({});
    setFormError(null);
    setConfirmDelete(false);
    if (target.mode === "create") {
      setForm({ colaborador: "", proyecto: "", fecha: today, tarea: "", desde: "", hasta: "", facturable: true, mesAFacturar: "" });
    } else {
      const r = target.record;
      setForm({
        colaborador: r.colaborador?.id ?? "",
        proyecto: r.proyecto?.id ?? "",
        fecha: r.fecha,
        tarea: r.tarea,
        desde: r.desde,
        hasta: r.hasta,
        facturable: r.facturable,
        mesAFacturar: r.mesAFacturar ? r.mesAFacturar.slice(0, 7) : "",
      });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function close() {
    setEditing(null);
    setForm(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !form) return;
    const { errors: local } = validateHora({ ...form }, "admin");
    if (Object.keys(local).length > 0) {
      setErrors(local);
      setFormError(HORA_MESSAGES.validacion);
      return;
    }
    setSaving(true);
    const res =
      editing.mode === "create" ? await callApi("POST", "/api/admin/horas", form) : await callApi("PATCH", `/api/admin/horas/${editing.record.id}`, form);
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      setFormError(res.error ?? "Ocurrió un error. Probá de nuevo.");
      return;
    }
    toast.success(editing.mode === "create" ? "Registro creado." : "Cambios guardados.");
    close();
    void reload();
  }

  async function remove() {
    if (editing?.mode !== "edit") return;
    setSaving(true);
    const res = await callApi("DELETE", `/api/admin/horas/${editing.record.id}`);
    setSaving(false);
    setConfirmDelete(false);
    if (!res.ok) return setFormError(res.error ?? "No se pudo borrar.");
    toast.success("Registro borrado.");
    close();
    void reload();
  }

  // Colaborador: solo Activos, más el que ya tenía el registro (aunque esté inactivo).
  const keepColaborador = editing?.mode === "edit" ? editing.record.colaborador?.id : undefined;
  const colaboradorOptions = options.usuarios
    .filter((u) => u.activo || u.id === keepColaborador)
    .map((u) => ({ value: u.id, label: u.activo ? u.nombre : `${u.nombre} · Inactivo` }));
  const set = <K extends keyof FormState>(key: K) => (value: FormState[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const live = form ? recordHours(parseTime(form.desde), parseTime(form.hasta)) : 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Horas</h1>
        {!editing && (
          <Button onClick={() => open({ mode: "create" })}>
            <Plus aria-hidden="true" className="size-4" />
            Nuevo registro
          </Button>
        )}
      </header>

      {editing && form && (
        <Card>
          <CardHeader>
            <CardTitle>{editing.mode === "create" ? "Nuevo registro" : "Editar registro"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              {formError && <InlineMessage tone="danger">{formError}</InlineMessage>}
              {editing.mode === "edit" && (
                <p className="text-sm text-muted">
                  Cargado por <span className="text-text">{editing.record.cargadoPor?.nombre ?? "—"}</span> (no cambia al editar).
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="Colaborador" required error={errors.colaborador}>
                  <Select value={form.colaborador} onChange={(e) => set("colaborador")(e.target.value)} placeholder="Elegí un colaborador" options={colaboradorOptions} disabled={saving} />
                </FormField>
                <FormField label="Proyecto" required error={errors.proyecto}>
                  <Select
                    value={form.proyecto}
                    onChange={(e) => set("proyecto")(e.target.value)}
                    placeholder="Elegí un proyecto"
                    options={options.proyectos.map((p) => ({ value: p.id, label: proyectoLabel(p) }))}
                    disabled={saving}
                  />
                </FormField>
                <FormField label="Fecha" required error={errors.fecha}>
                  <Input type="date" value={form.fecha} onChange={(e) => set("fecha")(e.target.value)} disabled={saving} />
                </FormField>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Desde" required error={errors.desde}>
                    <Input type="time" step={60} value={form.desde} onChange={(e) => set("desde")(e.target.value)} disabled={saving} />
                  </FormField>
                  <FormField label="Hasta" required error={errors.hasta}>
                    <Input type="time" step={60} value={form.hasta} onChange={(e) => set("hasta")(e.target.value)} disabled={saving} />
                  </FormField>
                </div>
                <FormField label="Tarea" required error={errors.tarea} id="horas-tarea" className="sm:col-span-2 lg:col-span-4">
                  <textarea
                    id="horas-tarea"
                    value={form.tarea}
                    maxLength={TAREA_MAX}
                    rows={2}
                    onChange={(e) => set("tarea")(e.target.value)}
                    disabled={saving}
                    aria-invalid={errors.tarea ? true : undefined}
                    className={cn(controlClasses, "h-auto min-h-16 py-2")}
                  />
                </FormField>
                <FormField label="Mes a facturar" error={errors.mesAFacturar} hint="Opcional.">
                  <Input type="month" value={form.mesAFacturar} onChange={(e) => set("mesAFacturar")(e.target.value)} disabled={saving} placeholder="AAAA-MM" />
                </FormField>
                <div className="flex items-end pb-2">
                  <Checkbox label="Facturable" checked={form.facturable} onChange={(e) => set("facturable")(e.target.checked)} disabled={saving} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar"}
                </Button>
                <Button variant="secondary" onClick={close} disabled={saving}>
                  Cancelar
                </Button>
                <p className="ml-2 text-sm text-muted" aria-live="polite">
                  Horas: <span className="font-medium text-text tabular-nums">{formatHours(live)}</span>
                </p>
                {editing.mode === "edit" && (
                  <div className="ml-auto flex items-center gap-2">
                    {confirmDelete ? (
                      <>
                        <span className="text-sm text-muted">¿Seguro que querés borrarlo?</span>
                        <Button variant="secondary" size="sm" onClick={remove} disabled={saving} className="text-danger">
                          Sí, borrar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={saving}>
                          No
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} disabled={saving}>
                        Borrar
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <PeriodFilter value={range} onChange={setRange} today={today} shortcuts={["mesActual", "mesAnterior"]} disabled={loading} />
        <div className="grid gap-2 sm:grid-cols-3 lg:w-[36rem]">
          <FormField label="Colaborador">
            <Select value={filters.colaborador} onChange={(e) => setFilters({ ...filters, colaborador: e.target.value })} placeholder="Todos" options={options.usuarios.map((u) => ({ value: u.id, label: u.nombre }))} />
          </FormField>
          <FormField label="Proyecto">
            <Select value={filters.proyecto} onChange={(e) => setFilters({ ...filters, proyecto: e.target.value })} placeholder="Todos" options={options.proyectos.map((p) => ({ value: p.id, label: proyectoLabel(p) }))} />
          </FormField>
          <FormField label="Cliente">
            <Select value={filters.cliente} onChange={(e) => setFilters({ ...filters, cliente: e.target.value })} placeholder="Todos" options={options.clientes.filter((c) => c.activo).map((c) => ({ value: c.id, label: c.nombre }))} />
          </FormField>
        </div>
      </div>
      {listError && <InlineMessage tone="danger">{listError}</InlineMessage>}

      <Table aria-busy={loading}>
        <TableHead>
          <tr>
            {["Fecha", "Colaborador", "Proyecto", "Cliente", "Tarea", "Desde", "Hasta"].map((h) => (
              <TableHeaderCell key={h}>{h}</TableHeaderCell>
            ))}
            <TableHeaderCell className="text-right">Horas</TableHeaderCell>
            <TableHeaderCell>Facturable</TableHeaderCell>
            <TableHeaderCell>Mes a facturar</TableHeaderCell>
            <TableHeaderCell>Cargado por</TableHeaderCell>
            <TableHeaderCell>
              <span className="sr-only">Acciones</span>
            </TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {list.records.length === 0 ? (
            <TableEmpty colSpan={12}>No hay horas con estos filtros.</TableEmpty>
          ) : (
            list.records.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">{displayDate(r.fecha)}</TableCell>
                <TableCell className="whitespace-nowrap">{r.colaborador?.nombre ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{r.proyecto ? proyectoLabel(r.proyecto) : "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{r.cliente?.nombre ?? "—"}</TableCell>
                <TableCell className="max-w-xs">{r.tarea}</TableCell>
                <TableCell className="tabular-nums">{r.desde}</TableCell>
                <TableCell className="tabular-nums">{r.hasta}</TableCell>
                <TableCell numeric>{formatHours(r.horas)}</TableCell>
                <TableCell>{r.facturable ? "Sí" : "No"}</TableCell>
                <TableCell className="tabular-nums">{displayMonth(r.mesAFacturar) || "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{r.cargadoPor?.nombre ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" aria-label={`Editar registro del ${displayDate(r.fecha)} de ${r.colaborador?.nombre ?? "sin colaborador"}`} onClick={() => open({ mode: "edit", record: r })}>
                    Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        <tfoot className="bg-surface">
          <tr>
            <th scope="row" colSpan={7} className="px-4 py-3 text-right font-medium text-muted">
              Total
            </th>
            <td className="px-4 py-3 text-right font-semibold text-white tabular-nums">{formatHours(list.total)}</td>
            <td colSpan={4} />
          </tr>
        </tfoot>
      </Table>
    </div>
  );
}
