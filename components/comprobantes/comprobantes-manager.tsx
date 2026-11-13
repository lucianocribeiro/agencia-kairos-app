"use client";

import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { callApi } from "@/components/abm/api";
import { getApi, query } from "@/components/horas/api";
import { PeriodFilter } from "@/components/horas/period-filter";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
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
import { cn } from "@/lib/cn";
import { formatCuit } from "@/lib/cuit";
import { formatNumber } from "@/lib/format";
import { displayDate, displayMonth, type DateRange } from "@/lib/horas/dates";
import { COLUMNS, KIND_LABEL, type Kind } from "@/lib/ventas-compras/columns";
import { CONTROL_FILTROS, SIN_PROYECTO, type FilaListado, type Totales } from "@/lib/ventas-compras/listado";
import { MENSAJES } from "@/lib/ventas-compras/rules";
import { OBSERVACIONES_MAX, type Contexto, type Ref } from "@/lib/ventas-compras/types";

export interface ListadoInicial {
  range: DateRange;
  filas: FilaListado[];
  cantidad: number;
  pagina: number;
  paginas: number;
  totales: Totales;
  opciones: { contrapartes: Ref[]; contexto: Contexto };
}

interface Filtros {
  mesDesde: string;
  mesHasta: string;
  contraparte: string;
  proyecto: string;
  categoria: string;
  control: string;
}
const SIN_FILTROS: Filtros = { mesDesde: "", mesHasta: "", contraparte: "", proyecto: "", categoria: "", control: "" };

type Form = { mesDevengado: string; proyecto: string; unidadNegocio: string; categoria: string; socio: string; observaciones: string };

const pesos = (cents: number) => formatNumber(cents / 100, { decimals: 2 });
const num = (v: unknown) => (typeof v === "number" ? formatNumber(v, { maxDecimals: 4 }) : String(v ?? ""));

/** Ventas › Comprobantes / Compras › Comprobantes: lista con filtros y totales, edición y borrado. */
export function ComprobantesManager({ kind, today, initial }: { kind: Kind; today: string; initial: ListadoInicial }) {
  const toast = useToast();
  const label = KIND_LABEL[kind];
  const [range, setRange] = useState<DateRange>(initial.range);
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [pagina, setPagina] = useState(1);
  const [data, setData] = useState<ListadoInicial>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FilaListado | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<FilaListado | null>(null);
  const first = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await getApi(`/api/admin/comprobantes/${kind}${query({ desde: range.desde, hasta: range.hasta, ...filtros, pagina: String(pagina) })}`);
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "No pudimos cargar la lista.");
    setError(null);
    setData(res.data as unknown as ListadoInicial);
  }, [kind, range, filtros, pagina]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void reload();
  }, [reload]);

  const ctx = data.opciones.contexto;
  const setFiltro = (key: keyof Filtros) => (value: string) => {
    setFiltros((f) => ({ ...f, [key]: value }));
    setPagina(1);
  };

  function open(row: FilaListado) {
    setEditing(row);
    setForm({ ...row.guardado });
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || !form) return;
    setSaving(true);
    const body = kind === "ventas" ? { ...form, socio: undefined } : form;
    const res = await callApi("PATCH", `/api/admin/comprobantes/${kind}/${editing.id}`, body);
    setSaving(false);
    if (!res.ok) return setFormError(res.error ?? "No se pudo guardar.");
    toast.success("Cambios guardados.");
    setEditing(null);
    setForm(null);
    void reload();
  }

  async function remove() {
    if (!deleting) return;
    setSaving(true);
    const res = await callApi("DELETE", `/api/admin/comprobantes/${kind}/${deleting.id}`);
    setSaving(false);
    const row = deleting;
    setDeleting(null);
    if (!res.ok) return setError(res.error ?? "No se pudo borrar.");
    toast.success(`Comprobante ${row.clave} borrado.`);
    if (editing?.id === row.id) setEditing(null);
    void reload();
  }

  const tipoCat = kind === "ventas" ? "Ingreso" : "Gasto";
  const categoriaOpts = ctx.categorias.filter((c) => c.tipo === tipoCat).map((c) => ({ value: c.id, label: c.nombre }));
  const proyectoOpts = (keep: string) => ctx.proyectos.filter((p) => p.activo || p.id === keep).map((p) => ({ value: p.id, label: p.activo ? p.codigo : `${p.codigo} (no activo)` }));
  const unidadOpts = ctx.unidades.map((u) => ({ value: u.id, label: u.nombre }));
  const socioOpts = ctx.socios.map((s) => ({ value: s.id, label: s.nombre }));
  const t = data.totales;
  const colSpan = kind === "ventas" ? 16 : 18;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{label.titulo}</h1>
        <Link href={`/${kind}/importar`} className="text-sm text-accent hover:underline">
          Importar desde ARCA
        </Link>
      </header>

      {editing && form && (
        <Card>
          <CardHeader>
            <CardTitle>
              {String(editing.datos.tipo ?? "")} {String(editing.datos.puntoVenta ?? "")}-{String(editing.datos.numeroDesde ?? "")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} noValidate className="flex flex-col gap-5">
              {formError && <InlineMessage tone="danger">{formError}</InlineMessage>}
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Clave ARCA</dt>
                  <dd className="tabular-nums">{editing.clave}</dd>
                </div>
                {COLUMNS[kind].map((c) => (
                  <div key={c.key}>
                    <dt className="text-xs text-muted">{c.header}</dt>
                    <dd className="tabular-nums">{c.type === "fecha" ? displayDate(String(editing.datos[c.key] ?? "")) : num(editing.datos[c.key]) || "—"}</dd>
                  </div>
                ))}
              </dl>
              <div className="grid gap-4 md:grid-cols-3">
                <FormField label="Mes devengado" hint={`Vacío: ${displayMonth(String(editing.datos.fecha ?? ""))} (mes de la Fecha).`}>
                  <Input type="month" value={form.mesDevengado} onChange={(e) => setForm({ ...form, mesDevengado: e.target.value })} disabled={saving} />
                </FormField>
                <FormField label="Proyecto">
                  <Select value={form.proyecto} onChange={(e) => setForm({ ...form, proyecto: e.target.value })} placeholder="Sin proyecto" options={proyectoOpts(editing.guardado.proyecto)} disabled={saving} />
                </FormField>
                <FormField label="Unidad de negocio" hint="Vacío: la del proyecto.">
                  <Select value={form.unidadNegocio} onChange={(e) => setForm({ ...form, unidadNegocio: e.target.value })} placeholder="La del proyecto" options={unidadOpts} disabled={saving} />
                </FormField>
                <FormField
                  label="Categoría"
                  hint={kind === "ventas" ? `Vacío: ${ctx.categoriaVentasPorDefecto.nombre ?? "sin categoría por defecto"} (Parámetro).` : "Vacío: la categoría por defecto del proveedor."}
                >
                  <Select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} placeholder="Por defecto" options={categoriaOpts} disabled={saving} />
                </FormField>
                {kind === "compras" && (
                  <FormField label="Imputar a socio">
                    <Select value={form.socio} onChange={(e) => setForm({ ...form, socio: e.target.value })} placeholder="No" options={socioOpts} disabled={saving} />
                  </FormField>
                )}
                <FormField label="Observaciones" className="md:col-span-3">
                  <Input value={form.observaciones} maxLength={OBSERVACIONES_MAX} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} disabled={saving} />
                </FormField>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar"}
                </Button>
                <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <section aria-label="Filtros" className="flex flex-col gap-3">
        <PeriodFilter value={range} onChange={(r) => (setRange(r), setPagina(1))} today={today} shortcuts={["mesActual", "mesAnterior", "trimestreActual", "anioActual"]} disabled={loading} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <FormField label="Devengado desde">
            <Input type="month" value={filtros.mesDesde} onChange={(e) => setFiltro("mesDesde")(e.target.value)} />
          </FormField>
          <FormField label="Devengado hasta">
            <Input type="month" value={filtros.mesHasta} onChange={(e) => setFiltro("mesHasta")(e.target.value)} />
          </FormField>
          <FormField label={kind === "ventas" ? "Cliente" : "Proveedor"}>
            <Select value={filtros.contraparte} onChange={(e) => setFiltro("contraparte")(e.target.value)} placeholder="Todos" options={data.opciones.contrapartes.map((c) => ({ value: c.id, label: c.nombre }))} />
          </FormField>
          <FormField label="Proyecto">
            <Select value={filtros.proyecto} onChange={(e) => setFiltro("proyecto")(e.target.value)} placeholder="Todos">
              <option value={SIN_PROYECTO}>Sin proyecto</option>
              {ctx.proyectos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Categoría">
            <Select value={filtros.categoria} onChange={(e) => setFiltro("categoria")(e.target.value)} placeholder="Todas" options={categoriaOpts} />
          </FormField>
          <FormField label="Control">
            <Select value={filtros.control} onChange={(e) => setFiltro("control")(e.target.value)} placeholder="Todos" options={CONTROL_FILTROS[kind]} />
          </FormField>
        </div>
      </section>

      {error && <InlineMessage tone="danger">{error}</InlineMessage>}

      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-live="polite">
        {[
          ["Total $", t.total],
          ["IVA $", t.iva],
          ["Neto $", t.neto],
          ...(kind === "compras"
            ? ([
                ["Impacto en resultados $", t.impacto],
                ["A cuenta del socio $", t.cuentaSocio],
              ] as const)
            : []),
        ].map(([name, value]) => (
          <div key={name} className="rounded-lg border border-line bg-card px-4 py-3">
            <dt className="text-xs text-muted">{name}</dt>
            <dd className="text-lg font-semibold text-white tabular-nums">{pesos(value as number)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">
        {data.cantidad} comprobantes · totales de todo el conjunto filtrado
      </p>

      <Table aria-busy={loading}>
        <TableHead>
          <tr>
            <TableHeaderCell>Fecha</TableHeaderCell>
            <TableHeaderCell>Tipo</TableHeaderCell>
            <TableHeaderCell>PV-Número</TableHeaderCell>
            <TableHeaderCell>{kind === "ventas" ? "Cliente" : "Proveedor"}</TableHeaderCell>
            <TableHeaderCell>Denominación</TableHeaderCell>
            <TableHeaderCell>Moneda</TableHeaderCell>
            <TableHeaderCell className="text-right">Total $</TableHeaderCell>
            <TableHeaderCell className="text-right">IVA $</TableHeaderCell>
            <TableHeaderCell className="text-right">Neto $</TableHeaderCell>
            {kind === "compras" && <TableHeaderCell className="text-right">Impacto $</TableHeaderCell>}
            {kind === "compras" && <TableHeaderCell className="text-right">A cuenta socio $</TableHeaderCell>}
            <TableHeaderCell>Mes devengado</TableHeaderCell>
            <TableHeaderCell>Proyecto</TableHeaderCell>
            <TableHeaderCell>UN</TableHeaderCell>
            <TableHeaderCell>Categoría</TableHeaderCell>
            <TableHeaderCell>Control</TableHeaderCell>
            <TableHeaderCell>
              <span className="sr-only">Acciones</span>
            </TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {data.filas.length === 0 ? (
            <TableEmpty colSpan={colSpan + 1}>No hay comprobantes con esos filtros.</TableEmpty>
          ) : (
            data.filas.map((r) => {
              const observado = r.control !== MENSAJES.ok;
              const d = r.datos;
              return (
                <TableRow key={r.id} className={cn(observado && "bg-surface/60 text-muted")} data-control={observado ? "observado" : "ok"}>
                  <TableCell className="whitespace-nowrap">{displayDate(String(d.fecha ?? ""))}</TableCell>
                  <TableCell className="whitespace-nowrap">{String(d.tipo ?? "")}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {String(d.puntoVenta ?? "")}-{String(d.numeroDesde ?? "")}
                  </TableCell>
                  <TableCell className="min-w-40">{r.contraparte?.nombre ?? <span className="italic">{kind === "ventas" ? MENSAJES.sinCliente : "—"}</span>}</TableCell>
                  <TableCell className="min-w-48">
                    {String(kind === "ventas" ? (d.denominacionReceptor ?? "") : (d.denominacionEmisor ?? ""))}
                    <span className="block text-xs text-muted tabular-nums">{formatCuit(String(kind === "ventas" ? (d.nroDocReceptor ?? "") : (d.nroDocEmisor ?? "")))}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {String(d.moneda ?? "") || "$"}
                    {typeof d.tipoCambio === "number" && d.tipoCambio > 0 && <span className="block text-xs text-muted">TC {num(d.tipoCambio)}</span>}
                  </TableCell>
                  <TableCell numeric>{pesos(r.importes.total)}</TableCell>
                  <TableCell numeric>{pesos(r.importes.iva)}</TableCell>
                  <TableCell numeric>{pesos(r.importes.neto)}</TableCell>
                  {kind === "compras" && <TableCell numeric>{pesos(r.importes.impacto)}</TableCell>}
                  {kind === "compras" && <TableCell numeric>{pesos(r.importes.cuentaSocio)}</TableCell>}
                  <TableCell className="whitespace-nowrap tabular-nums">{displayMonth(r.mesDevengado)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.proyecto?.codigo ?? "—"}</TableCell>
                  <TableCell>{r.unidadNegocio?.nombre ?? "—"}</TableCell>
                  <TableCell className="min-w-40">{r.categoria?.nombre ?? "—"}</TableCell>
                  <TableCell className={cn("min-w-40", observado && "italic")}>{r.control}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="sm" aria-label={`Editar ${r.clave}`} onClick={() => open(r)}>
                      <Pencil aria-hidden="true" className="size-4" />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`Borrar ${r.clave}`} onClick={() => setDeleting(r)}>
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {data.paginas > 1 && (
        <nav aria-label="Páginas" className="flex items-center gap-3 text-sm">
          <Button variant="secondary" size="sm" disabled={loading || data.pagina <= 1} onClick={() => setPagina(data.pagina - 1)}>
            Anterior
          </Button>
          <span className="text-muted">
            Página {data.pagina} de {data.paginas}
          </span>
          <Button variant="secondary" size="sm" disabled={loading || data.pagina >= data.paginas} onClick={() => setPagina(data.pagina + 1)}>
            Siguiente
          </Button>
        </nav>
      )}

      <ConfirmDialog open={!!deleting} title="¿Borrar este comprobante?" confirmLabel="Sí, borrar" busy={saving} busyLabel="Borrando…" onConfirm={remove} onCancel={() => setDeleting(null)}>
        {deleting && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>Clave ARCA</dt>
            <dd className="text-text tabular-nums">{deleting.clave}</dd>
            <dt>Fecha</dt>
            <dd className="text-text">{displayDate(String(deleting.datos.fecha ?? ""))}</dd>
            <dt>Denominación</dt>
            <dd className="text-text">{String(kind === "ventas" ? (deleting.datos.denominacionReceptor ?? "") : (deleting.datos.denominacionEmisor ?? ""))}</dd>
            <dt>Total $</dt>
            <dd className="text-text tabular-nums">{pesos(deleting.importes.total)}</dd>
          </dl>
        )}
        <p className="mt-3">No se puede deshacer. Si volvés a importar el archivo, vuelve como Nueva.</p>
      </ConfirmDialog>
    </div>
  );
}
