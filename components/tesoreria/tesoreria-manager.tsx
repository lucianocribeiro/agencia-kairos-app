"use client";

import { ArrowLeftRight, Pencil, Plus, Trash2 } from "lucide-react";
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
import { controlClasses } from "@/components/ui/control-classes";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { displayDate, type DateRange } from "@/lib/horas/dates";
import { CONTROL, TIPO_TRANSFERENCIA, type CuentaCtx, type TesoreriaCtx } from "@/lib/tesoreria/rules";

/** Lo que manda el servidor (lib/tesoreria/server/movimientos.ts). Client-safe: solo tipos. */
export interface FilaTesoreriaDTO {
  id: string;
  numero: number | null;
  fecha: string | null;
  cuenta: string | null;
  movimiento: string | null;
  importe: number | null;
  tipoOperacion: string | null;
  cliente: string | null;
  proveedor: string | null;
  sumaResultados: string | null;
  categoria: string | null;
  socio: string | null;
  tipoCambio: number | null;
  descripcion: string;
  transferencia: string | null;
  importeSigno: number;
  importePesos: number | null;
  suma: "S" | "N";
  categoriaEfectiva: { id: string; nombre: string } | null;
  impacto: number;
  cuentaSocio: number;
  saldo: number;
  control: string;
  tipo: { id: string; nombre: string } | null;
  tercero: { id: string; nombre: string } | null;
  socioRef: { id: string; nombre: string } | null;
  otraCuenta: { id: string; nombre: string } | null;
}

export interface TesoreriaInicial {
  cuenta: CuentaCtx;
  range: DateRange;
  filas: FilaTesoreriaDTO[];
  cantidad: number;
  pagina: number;
  paginas: number;
  saldoActual: number;
  saldoInicioPeriodo: number;
  saldoFinPeriodo: number;
  totales: { entradas: number; salidas: number; neto: number; pesos: number; impacto: number; cuentaSocio: number };
  contexto: TesoreriaCtx;
}

type Mov = {
  fecha: string;
  cuenta: string;
  movimiento: string;
  importe: string;
  tipoOperacion: string;
  cliente: string;
  proveedor: string;
  sumaResultados: string;
  categoria: string;
  socio: string;
  tipoCambio: string;
  descripcion: string;
};
type Trf = { cuentaOrigen: string; cuentaDestino: string; importe: string; fecha: string; tipoCambio: string; descripcion: string };
type Editing = { kind: "mov"; id: string | null; form: Mov } | { kind: "trf"; id: string | null; form: Trf };

const CONTROL_OPCIONES = [
  { value: "ok", label: "OK" },
  { value: "observaciones", label: "Con observaciones" },
];

const money = (cents: number | null) => (cents === null ? "—" : formatNumber(cents / 100, { decimals: 2 }));
const numText = (n: number | null, max = 2) => (n === null ? "" : formatNumber(n, { maxDecimals: max }).replace(/\./g, ""));

/** Tesorería: lista por cuenta con saldo corrido, filtros, totales, movimientos y transferencias propias. */
export function TesoreriaManager({ today, initial }: { today: string; initial: TesoreriaInicial | null }) {
  const toast = useToast();
  const [data, setData] = useState<TesoreriaInicial | null>(initial);
  const [cuenta, setCuenta] = useState(initial?.cuenta.id ?? "");
  const [range, setRange] = useState<DateRange>(initial?.range ?? { desde: `${today.slice(0, 4)}-01-01`, hasta: `${today.slice(0, 4)}-12-31` });
  const [filtros, setFiltros] = useState({ tipo: "", movimiento: "", control: "" });
  const [pagina, setPagina] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<FilaTesoreriaDTO | null>(null);
  const first = useRef(true);

  const reload = useCallback(async () => {
    if (!cuenta) return;
    setLoading(true);
    const res = await getApi(`/api/admin/tesoreria${query({ cuenta, desde: range.desde, hasta: range.hasta, ...filtros, pagina: String(pagina) })}`);
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "No pudimos cargar Tesorería.");
    setError(null);
    setData(res.data as unknown as TesoreriaInicial);
  }, [cuenta, range, filtros, pagina]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void reload();
  }, [reload]);

  if (!data) return <InlineMessage tone="info">Todavía no hay cuentas. Cargalas en Maestros › Cuentas.</InlineMessage>;
  const ctx = data.contexto;
  const moneda = (id: string) => ctx.cuentas.find((c) => c.id === id)?.moneda ?? null;
  const tipoById = (id: string) => ctx.tipos.find((t) => t.id === id);
  const tiposMov = ctx.tipos.filter((t) => t.nombre !== TIPO_TRANSFERENCIA);
  const opts = (list: { id: string; nombre: string }[]) => list.map((x) => ({ value: x.id, label: x.nombre }));
  const sym = data.cuenta.moneda === "USD" ? "US$" : "$";

  function nuevoMovimiento() {
    setFormError(null);
    setEditing({
      kind: "mov",
      id: null,
      form: { fecha: today, cuenta, movimiento: "", importe: "", tipoOperacion: "", cliente: "", proveedor: "", sumaResultados: "", categoria: "", socio: "", tipoCambio: "", descripcion: "" },
    });
  }
  function nuevaTransferencia() {
    setFormError(null);
    setEditing({ kind: "trf", id: null, form: { cuentaOrigen: cuenta, cuentaDestino: "", importe: "", fecha: today, tipoCambio: "", descripcion: "" } });
  }
  function editar(r: FilaTesoreriaDTO) {
    setFormError(null);
    if (r.transferencia) {
      // El par: esta fila y la otra cuenta. La de origen es el Pago.
      const esPago = r.movimiento === "Pago";
      setEditing({
        kind: "trf",
        id: r.transferencia,
        form: {
          cuentaOrigen: esPago ? (r.cuenta ?? "") : (r.otraCuenta?.id ?? ""),
          cuentaDestino: esPago ? (r.otraCuenta?.id ?? "") : (r.cuenta ?? ""),
          importe: numText(r.importe),
          fecha: r.fecha ?? "",
          tipoCambio: numText(r.tipoCambio, 4),
          descripcion: r.descripcion,
        },
      });
    } else {
      setEditing({
        kind: "mov",
        id: r.id,
        form: {
          fecha: r.fecha ?? "",
          cuenta: r.cuenta ?? "",
          movimiento: r.movimiento ?? "",
          importe: numText(r.importe),
          tipoOperacion: r.tipoOperacion ?? "",
          cliente: r.cliente ?? "",
          proveedor: r.proveedor ?? "",
          sumaResultados: r.sumaResultados ?? "",
          categoria: r.categoria ?? "",
          socio: r.socio ?? "",
          tipoCambio: numText(r.tipoCambio, 4),
          descripcion: r.descripcion,
        },
      });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    const base = editing.kind === "mov" ? "/api/admin/tesoreria" : "/api/admin/tesoreria/transferencias";
    // Los campos que el formulario oculta se mandan vacíos (tercero según el movimiento, socio según el tipo).
    const body =
      editing.kind === "mov"
        ? {
            ...editing.form,
            cliente: editing.form.movimiento === "Cobranza" ? editing.form.cliente : "",
            proveedor: editing.form.movimiento === "Pago" ? editing.form.proveedor : "",
            socio: tipoById(editing.form.tipoOperacion)?.esDeSocio ? editing.form.socio : "",
          }
        : editing.form;
    const res = editing.id ? await callApi("PATCH", `${base}/${editing.id}`, body) : await callApi("POST", base, body);
    setSaving(false);
    if (!res.ok) return setFormError(res.error ?? "No se pudo guardar.");
    toast.success(editing.kind === "trf" ? "Transferencia guardada." : "Movimiento guardado.");
    setEditing(null);
    void reload();
  }

  async function remove() {
    if (!deleting) return;
    setSaving(true);
    const url = deleting.transferencia ? `/api/admin/tesoreria/transferencias/${deleting.transferencia}` : `/api/admin/tesoreria/${deleting.id}`;
    const res = await callApi("DELETE", url);
    setSaving(false);
    setDeleting(null);
    if (!res.ok) return setError(res.error ?? "No se pudo borrar.");
    toast.success(deleting.transferencia ? "Transferencia borrada (los 2 registros)." : "Movimiento borrado.");
    void reload();
  }

  const set = <K extends string>(key: K) => (value: string) => setEditing((e) => (e ? ({ ...e, form: { ...e.form, [key]: value } } as Editing) : e));
  const movForm = editing?.kind === "mov" ? editing.form : null;
  const trfForm = editing?.kind === "trf" ? editing.form : null;
  const tipoSel = movForm ? tipoById(movForm.tipoOperacion) : undefined;
  const t = data.totales;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Tesorería</h1>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={nuevoMovimiento}>
              <Plus aria-hidden="true" className="size-4" />
              Nuevo movimiento
            </Button>
            <Button variant="secondary" onClick={nuevaTransferencia}>
              <ArrowLeftRight aria-hidden="true" className="size-4" />
              Transferencia entre cuentas
            </Button>
          </div>
        )}
      </header>

      {movForm && editing && (
        <Card>
          <CardHeader>
            <CardTitle>{editing.id ? "Editar movimiento" : "Nuevo movimiento"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} noValidate className="flex flex-col gap-5">
              {formError && <InlineMessage tone="danger">{formError}</InlineMessage>}
              <div className="grid gap-4 md:grid-cols-3">
                <FormField label="Fecha" required>
                  <Input type="date" value={movForm.fecha} onChange={(e) => set("fecha")(e.target.value)} disabled={saving} />
                </FormField>
                <FormField label="Cuenta" required>
                  <Select value={movForm.cuenta} onChange={(e) => set("cuenta")(e.target.value)} placeholder="Elegí una cuenta" options={opts(ctx.cuentas)} disabled={saving} />
                </FormField>
                <FormField label="Movimiento" required>
                  <Select value={movForm.movimiento} onChange={(e) => set("movimiento")(e.target.value)} placeholder="Elegí" options={[{ value: "Cobranza", label: "Cobranza (entra)" }, { value: "Pago", label: "Pago (sale)" }]} disabled={saving} />
                </FormField>
                <FormField label={`Importe (${moneda(movForm.cuenta) ?? "moneda de la cuenta"})`} required>
                  <Input inputMode="decimal" value={movForm.importe} onChange={(e) => set("importe")(e.target.value)} placeholder="0,00" disabled={saving} />
                </FormField>
                <FormField label="Tipo de operación" required>
                  <Select value={movForm.tipoOperacion} onChange={(e) => set("tipoOperacion")(e.target.value)} placeholder="Elegí un tipo" options={opts(tiposMov)} disabled={saving} />
                </FormField>
                {moneda(movForm.cuenta) === "USD" && (
                  <FormField label="Tipo de cambio" required hint="Hasta 4 decimales.">
                    <Input inputMode="decimal" value={movForm.tipoCambio} onChange={(e) => set("tipoCambio")(e.target.value)} disabled={saving} />
                  </FormField>
                )}
                {movForm.movimiento === "Cobranza" && (
                  <FormField label="Cliente" required={!!tipoSel?.pideTercero}>
                    <Select value={movForm.cliente} onChange={(e) => set("cliente")(e.target.value)} placeholder="Sin cliente" options={opts(ctx.clientes)} disabled={saving} />
                  </FormField>
                )}
                {movForm.movimiento === "Pago" && (
                  <FormField label="Proveedor" required={!!tipoSel?.pideTercero}>
                    <Select value={movForm.proveedor} onChange={(e) => set("proveedor")(e.target.value)} placeholder="Sin proveedor" options={opts(ctx.proveedores)} disabled={saving} />
                  </FormField>
                )}
                {tipoSel?.esDeSocio && (
                  <FormField label="Socio" required>
                    <Select value={movForm.socio} onChange={(e) => set("socio")(e.target.value)} placeholder="Elegí un socio" options={opts(ctx.socios)} disabled={saving} />
                  </FormField>
                )}
                <FormField label="Suma a resultados" hint={tipoSel ? `Vacío: ${tipoSel.esDeSocio ? "N (de socio)" : tipoSel.suma ? "S" : "N"} (según el tipo).` : undefined}>
                  <Select value={movForm.sumaResultados} onChange={(e) => set("sumaResultados")(e.target.value)} placeholder="Según el tipo" options={[{ value: "S", label: "S" }, { value: "N", label: "N" }]} disabled={saving} />
                </FormField>
                <FormField label="Categoría" hint="Vacío: la del tipo de operación (si suma a resultados).">
                  <Select value={movForm.categoria} onChange={(e) => set("categoria")(e.target.value)} placeholder="La del tipo" options={opts(ctx.categorias)} disabled={saving} />
                </FormField>
                <FormField label="Descripción" className="md:col-span-3" id="tes-desc">
                  <textarea id="tes-desc" value={movForm.descripcion} maxLength={2000} rows={2} onChange={(e) => set("descripcion")(e.target.value)} disabled={saving} className={cn(controlClasses, "h-auto min-h-16 py-2")} />
                </FormField>
              </div>
              <div className="flex gap-2">
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

      {trfForm && editing && (
        <Card>
          <CardHeader>
            <CardTitle>{editing.id ? "Editar transferencia entre cuentas propias" : "Transferencia entre cuentas propias"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} noValidate className="flex flex-col gap-5">
              {formError && <InlineMessage tone="danger">{formError}</InlineMessage>}
              <p className="text-sm text-muted">Se guardan 2 registros (Pago en origen y Cobranza en destino). No impacta en resultados.</p>
              <div className="grid gap-4 md:grid-cols-3">
                <FormField label="Cuenta origen" required>
                  <Select value={trfForm.cuentaOrigen} onChange={(e) => set("cuentaOrigen")(e.target.value)} placeholder="Elegí" options={opts(ctx.cuentas)} disabled={saving} />
                </FormField>
                <FormField label="Cuenta destino" required>
                  <Select value={trfForm.cuentaDestino} onChange={(e) => set("cuentaDestino")(e.target.value)} placeholder="Elegí" options={opts(ctx.cuentas)} disabled={saving} />
                </FormField>
                <FormField label="Fecha" required>
                  <Input type="date" value={trfForm.fecha} onChange={(e) => set("fecha")(e.target.value)} disabled={saving} />
                </FormField>
                <FormField label="Importe" required>
                  <Input inputMode="decimal" value={trfForm.importe} onChange={(e) => set("importe")(e.target.value)} placeholder="0,00" disabled={saving} />
                </FormField>
                {moneda(trfForm.cuentaOrigen) === "USD" && (
                  <FormField label="Tipo de cambio" required hint="El mismo en los 2 registros.">
                    <Input inputMode="decimal" value={trfForm.tipoCambio} onChange={(e) => set("tipoCambio")(e.target.value)} disabled={saving} />
                  </FormField>
                )}
                <FormField label="Descripción" className="md:col-span-3">
                  <Input value={trfForm.descripcion} maxLength={2000} onChange={(e) => set("descripcion")(e.target.value)} disabled={saving} />
                </FormField>
              </div>
              <div className="flex gap-2">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Cuenta" required>
            <Select value={cuenta} onChange={(e) => (setCuenta(e.target.value), setPagina(1))} options={ctx.cuentas.map((c) => ({ value: c.id, label: `${c.nombre} (${c.moneda ?? "?"})` }))} />
          </FormField>
          <FormField label="Tipo de operación">
            <Select value={filtros.tipo} onChange={(e) => (setFiltros({ ...filtros, tipo: e.target.value }), setPagina(1))} placeholder="Todos" options={opts(ctx.tipos)} />
          </FormField>
          <FormField label="Movimiento">
            <Select value={filtros.movimiento} onChange={(e) => (setFiltros({ ...filtros, movimiento: e.target.value }), setPagina(1))} placeholder="Todos" options={[{ value: "Cobranza", label: "Cobranza" }, { value: "Pago", label: "Pago" }]} />
          </FormField>
          <FormField label="Control">
            <Select value={filtros.control} onChange={(e) => (setFiltros({ ...filtros, control: e.target.value }), setPagina(1))} placeholder="Todos" options={CONTROL_OPCIONES} />
          </FormField>
        </div>
        <PeriodFilter value={range} onChange={(r) => (setRange(r), setPagina(1))} today={today} shortcuts={["mesActual", "mesAnterior", "trimestreActual", "anioActual"]} disabled={loading} />
      </section>

      {error && <InlineMessage tone="danger">{error}</InlineMessage>}

      <dl className="grid gap-3 sm:grid-cols-3" aria-live="polite">
        {[
          [`Saldo actual (${sym})`, data.saldoActual],
          [`Saldo al inicio del período (${sym})`, data.saldoInicioPeriodo],
          [`Saldo al final del período (${sym})`, data.saldoFinPeriodo],
          [`Entradas (${sym})`, t.entradas],
          [`Salidas (${sym})`, t.salidas],
          [`Neto (${sym})`, t.neto],
          ["Importe $", t.pesos],
          ["Impacto en resultados $", t.impacto],
          ["A cuenta del socio $", t.cuentaSocio],
        ].map(([name, value]) => (
          <div key={name as string} className="rounded-lg border border-line bg-card px-4 py-3">
            <dt className="text-xs text-muted">{name}</dt>
            <dd className="text-lg font-semibold text-white tabular-nums">{money(value as number)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">
        {data.cantidad} movimientos · totales de todo el conjunto filtrado · el saldo incluye el saldo inicial de la cuenta y todos los movimientos anteriores
      </p>

      <Table aria-busy={loading}>
        <TableHead>
          <tr>
            <TableHeaderCell>N°</TableHeaderCell>
            <TableHeaderCell>Fecha</TableHeaderCell>
            <TableHeaderCell>Movimiento</TableHeaderCell>
            <TableHeaderCell className="text-right">Importe ({sym})</TableHeaderCell>
            <TableHeaderCell className="text-right">TC</TableHeaderCell>
            <TableHeaderCell className="text-right">Importe $</TableHeaderCell>
            <TableHeaderCell>Tipo</TableHeaderCell>
            <TableHeaderCell>Cliente / Proveedor</TableHeaderCell>
            <TableHeaderCell>Suma</TableHeaderCell>
            <TableHeaderCell>Categoría</TableHeaderCell>
            <TableHeaderCell>Socio</TableHeaderCell>
            <TableHeaderCell>Descripción</TableHeaderCell>
            <TableHeaderCell className="text-right">Saldo ({sym})</TableHeaderCell>
            <TableHeaderCell>Control</TableHeaderCell>
            <TableHeaderCell>
              <span className="sr-only">Acciones</span>
            </TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {data.filas.length === 0 ? (
            <TableEmpty colSpan={15}>No hay movimientos con esos filtros.</TableEmpty>
          ) : (
            data.filas.map((r) => {
              const observado = r.control !== CONTROL.ok;
              return (
                <TableRow key={r.id} className={cn(observado && "bg-surface/60 text-muted")} data-control={observado ? "observado" : "ok"}>
                  <TableCell className="tabular-nums">{r.numero ?? ""}</TableCell>
                  <TableCell className="whitespace-nowrap">{displayDate(r.fecha)}</TableCell>
                  <TableCell>{r.movimiento}</TableCell>
                  <TableCell numeric>{money(r.importeSigno)}</TableCell>
                  <TableCell numeric>{r.tipoCambio === null ? "" : formatNumber(r.tipoCambio, { maxDecimals: 4 })}</TableCell>
                  <TableCell numeric>{money(r.importePesos)}</TableCell>
                  <TableCell className="min-w-40">
                    {r.tipo?.nombre ?? "—"}
                    {r.transferencia && <span className="block text-xs text-accent">{r.movimiento === "Pago" ? "→" : "←"} {r.otraCuenta?.nombre ?? "(otra cuenta)"}</span>}
                  </TableCell>
                  <TableCell>{r.tercero?.nombre ?? "—"}</TableCell>
                  <TableCell>{r.suma}</TableCell>
                  <TableCell>{r.categoriaEfectiva?.nombre ?? "—"}</TableCell>
                  <TableCell>{r.socioRef?.nombre ?? "—"}</TableCell>
                  <TableCell className="max-w-64">{r.descripcion}</TableCell>
                  <TableCell numeric className="font-medium">
                    {money(r.saldo)}
                  </TableCell>
                  <TableCell className={cn("min-w-40", observado && "italic")}>{r.control}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="sm" aria-label={`Editar N° ${r.numero}`} onClick={() => editar(r)}>
                      <Pencil aria-hidden="true" className="size-4" />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`Borrar N° ${r.numero}`} onClick={() => setDeleting(r)}>
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

      <ConfirmDialog
        open={!!deleting}
        title={deleting?.transferencia ? "¿Borrar la transferencia?" : "¿Borrar este movimiento?"}
        confirmLabel={deleting?.transferencia ? "Sí, borrar la transferencia" : "Sí, borrar"}
        busy={saving}
        busyLabel="Borrando…"
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      >
        {deleting && (
          <p>
            N° {deleting.numero} · {displayDate(deleting.fecha)} · {deleting.movimiento} {money(deleting.importeSigno)} {sym}
            {deleting.transferencia && (
              <>
                <br />
                {deleting.otraCuenta
                  ? `Es parte de una transferencia con «${deleting.otraCuenta.nombre}»: se borran los 2 registros juntos.`
                  : "Es parte de una transferencia incompleta: se borran todos los registros con ese ID."}
              </>
            )}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
