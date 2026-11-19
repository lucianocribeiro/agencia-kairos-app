"use client";

import { RefreshCw, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
} from "@/components/ui";
import { MES_ANIO_MESSAGES, MesAnioInput } from "@/components/ui/mes-anio-select";
import { cn } from "@/lib/cn";
import { formatCuit } from "@/lib/cuit";
import { formatNumber } from "@/lib/format";
import { displayDate, todayInBuenosAires } from "@/lib/horas/dates";
import { KIND_LABEL, type Kind } from "@/lib/ventas-compras/columns";
import { evaluar, MENSAJES } from "@/lib/ventas-compras/rules";
import { ESTADO_LABEL, OBSERVACIONES_MAX, type Ediciones, type FilaBase, type Preview, type ResultadoImportacion } from "@/lib/ventas-compras/types";
import { ArcaSyncDialog } from "./arca-sync-dialog";

/** Igual que el límite del servidor (lib/ventas-compras/server/upload.ts). */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MUY_GRANDE = "El archivo supera los 4 MB. Exportá un período más corto desde ARCA.";

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; status?: number };

export const ARCA_UI_MESSAGES = {
  titulo: "Sincronizar con ARCA",
  noConfigurada: "La sincronización con ARCA no está configurada.",
  consultando: "Consultando ARCA… esto puede tardar unos minutos.",
  dejarDeConsultar: "Dejar de consultar",
  cancelado: "Dejaste de consultar. Si ARCA termina después, esa sincronización vence sola; podés sincronizar de nuevo.",
} as const;

/** Cada cuánto consulta el navegador el estado de la sincronización. */
export const POLL_MS = 5000;
/** Fallas transitorias (503) seguidas antes de dejar de consultar. */
const MAX_POLL_FAILURES = 5;

/** GET / POST JSON a una API propia. Nunca lanza. */
async function requestJson<T>(url: string, body?: unknown): Promise<ApiOk<T> | ApiErr> {
  try {
    const res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, error: typeof data.error === "string" ? data.error : "Ocurrió un error. Probá de nuevo." };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "No pudimos conectarnos. Revisá tu conexión y probá de nuevo." };
  }
}

type PollData = { estado: "en_proceso" } | { estado: "sin_comprobantes"; mensaje: string } | { estado: "lista"; preview: Preview; payload: string };

/** POST multipart a una API propia. Nunca lanza. */
async function postForm<T>(url: string, form: FormData): Promise<ApiOk<T> | ApiErr> {
  try {
    const res = await fetch(url, { method: "POST", body: form, credentials: "same-origin" });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 413) return { ok: false, error: MUY_GRANDE };
    if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : "Ocurrió un error. Probá de nuevo." };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "No pudimos conectarnos. Revisá tu conexión y probá de nuevo." };
  }
}

const pesos = (cents: number) => formatNumber(cents / 100, { decimals: 2 });
const importe = (v: unknown) => (typeof v === "number" ? formatNumber(v, { decimals: 2 }) : "");

const ESTADO_CLASS: Record<FilaBase["estado"], string> = {
  nueva: "text-accent-text",
  ya_importada: "text-muted",
  duplicada: "text-muted",
  error: "text-danger",
};

export interface ArcaProps {
  /** El servidor dice si AFIP_SDK_TOKEN está configurado (nunca manda el token). */
  configurado: boolean;
  /** Abrir el diálogo al entrar (link «Sincronizar con ARCA» de la lista). */
  abrir?: boolean;
}

/**
 * Ventas › Importar / Compras › Importar: dos orígenes con la misma vista previa editable,
 * confirmación e informe. El .xlsx de ARCA (sin cambios) o «Sincronizar con ARCA» (CC-F5-03):
 * diálogo → consulta cada 5 s → vista previa → confirmar con el payload firmado.
 */
export function ImportManager({ kind, today, arca = { configurado: false } }: { kind: Kind; today?: string; arca?: ArcaProps }) {
  const label = KIND_LABEL[kind];
  const hoy = today ?? todayInBuenosAires();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [edits, setEdits] = useState<Record<string, Ediciones>>({});
  /** Filas con Mes devengado a medias (mes o año sin elegir): no se puede confirmar. */
  const [mesIncompleto, setMesIncompleto] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "confirm" | null>(null);
  const [result, setResult] = useState<ResultadoImportacion | null>(null);
  /** De dónde viene la vista previa actual. */
  const [source, setSource] = useState<"excel" | "arca">("excel");
  /** Sincronización lista para confirmar (ID del log + payload firmado). */
  const [sync, setSync] = useState<{ id: string; payload: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(arca.configurado && arca.abrir === true);
  /** ID de la sincronización que se está consultando. */
  const [polling, setPolling] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await requestJson<PollData>(`/api/admin/arca/sincronizaciones/${encodeURIComponent(polling)}`);
      if (cancelled) return;
      if (res.ok && res.data.estado === "en_proceso") {
        failures = 0;
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      if (!res.ok && (res.status === 503 || res.status === undefined) && ++failures < MAX_POLL_FAILURES) {
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      setPolling(null);
      if (!res.ok) return setError(res.error);
      if (res.data.estado === "sin_comprobantes") return setInfo(res.data.mensaje);
      if (res.data.estado === "lista") {
        setSource("arca");
        setSync({ id: polling, payload: res.data.payload });
        setPreview(res.data.preview);
        setEdits({});
        setMesIncompleto(new Set());
      }
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [polling]);

  function reset() {
    setFile(null);
    setPreview(null);
    setEdits({});
    setMesIncompleto(new Set());
    setError(null);
    setResult(null);
    setSync(null);
    setSource("excel");
    setInfo(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function form(withEdits: boolean): FormData {
    const fd = new FormData();
    fd.append("archivo", file!);
    if (withEdits) fd.append("ediciones", JSON.stringify(edits));
    return fd;
  }

  async function loadPreview(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setInfo(null);
    if (!file) return setError("Elegí el archivo .xlsx de ARCA.");
    if (file.size > MAX_FILE_BYTES) return setError(MUY_GRANDE);
    setBusy("preview");
    const res = await postForm<Preview & { ok: true }>(`/api/admin/importar/${kind}/preview`, form(false));
    setBusy(null);
    if (!res.ok) {
      setPreview(null);
      return setError(res.error);
    }
    setSource("excel");
    setSync(null);
    setPreview(res.data);
    setEdits({});
    setMesIncompleto(new Set());
  }

  async function confirm() {
    if (!preview) return;
    if (source === "excel" && !file) return;
    if (source === "arca" && !sync) return;
    if (mesIncompleto.size > 0) return setError(MES_ANIO_MESSAGES.incompletoFilas);
    setError(null);
    setBusy("confirm");
    const res =
      source === "arca"
        ? await requestJson<ResultadoImportacion & { ok: true }>(`/api/admin/arca/${kind}/confirmar`, { syncId: sync!.id, payload: sync!.payload, ediciones: edits })
        : await postForm<ResultadoImportacion & { ok: true }>(`/api/admin/importar/${kind}/confirmar`, form(true));
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setResult(res.data);
    setPreview(null);
    setSync(null);
  }

  /** «fila N» en el .xlsx; «comprobante N» en lo que vino de ARCA (no hay hoja). */
  const filaLabel = (n: number) => (source === "arca" ? `comprobante ${n}` : `fila ${n}`);

  const setEdit = (clave: string, key: keyof Ediciones, value: string) =>
    setEdits((prev) => ({ ...prev, [clave]: { ...prev[clave], [key]: value } }));
  /** "AAAA-MM" o "" se guardan como edición (igual que el input nativo); null (a medias) no cambia la edición. */
  const setMesDevengado = (clave: string, value: string | null) => {
    setMesIncompleto((prev) => {
      const next = new Set(prev);
      if (value === null) next.add(clave);
      else next.delete(clave);
      return next;
    });
    if (value !== null) setEdit(clave, "mesDevengado", value);
  };

  const ctx = preview?.contexto;
  const rows = useMemo(
    () => (preview && ctx ? preview.filas.map((f) => ({ f, ed: (f.clave && edits[f.clave]) || {}, ev: evaluar(kind, f, (f.clave && edits[f.clave]) || {}, ctx) })) : []),
    [preview, ctx, edits, kind],
  );
  const nuevas = preview?.resumen.nuevas ?? 0;

  const proyectoOpts = (ctx?.proyectos ?? []).filter((p) => p.activo).map((p) => ({ value: p.id, label: p.codigo }));
  const unidadOpts = (ctx?.unidades ?? []).map((u) => ({ value: u.id, label: u.nombre }));
  const categoriaOpts = (ctx?.categorias ?? []).filter((c) => c.tipo === (kind === "ventas" ? "Ingreso" : "Gasto")).map((c) => ({ value: c.id, label: c.nombre }));
  const socioOpts = (ctx?.socios ?? []).map((s) => ({ value: s.id, label: s.nombre }));
  const nombreDe = (list: { id: string; nombre: string }[] | undefined, id: string | null) => (id ? (list?.find((x) => x.id === id)?.nombre ?? "") : "");

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-strong">Importar {label.titulo.toLowerCase()}</h1>
        <p className="text-sm text-muted">
          Subí el .xlsx de «{label.archivo}» descargado de ARCA (hasta 4 MB y 1.000 comprobantes) o sincronizá directamente con ARCA.
        </p>
      </header>

      {error && <InlineMessage tone="danger">{error}</InlineMessage>}
      {info && <InlineMessage tone="info">{info}</InlineMessage>}

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Importación terminada</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              <li>
                Importadas: <strong className="text-strong tabular-nums">{result.importadas}</strong>
              </li>
              <li>
                Omitidas por duplicado:{" "}
                <strong className="text-strong tabular-nums">
                  {result.omitidas.yaImportadas + result.omitidas.duplicadasEnArchivo + result.omitidas.enParalelo}
                </strong>{" "}
                <span className="text-muted">
                  (ya importadas: {result.omitidas.yaImportadas}; duplicadas en el archivo: {result.omitidas.duplicadasEnArchivo}
                  {result.omitidas.enParalelo > 0 ? `; importadas en paralelo: ${result.omitidas.enParalelo}` : ""})
                </span>
              </li>
              <li>
                Con error: <strong className="text-strong tabular-nums">{result.conError.length}</strong>
              </li>
              {kind === "compras" && (
                <li>
                  Proveedores creados: <strong className="text-strong tabular-nums">{result.proveedoresCreados.length}</strong>
                </li>
              )}
            </ul>
            {result.conError.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-muted">
                {result.conError.map((e) => (
                  <li key={e.fila}>
                    {source === "arca" ? "Comprobante" : "Fila"} {e.fila}: {e.motivo}
                  </li>
                ))}
              </ul>
            )}
            {result.proveedoresCreados.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-muted">
                {result.proveedoresCreados.map((p) => (
                  <li key={p.cuit}>
                    {p.nombre} ({formatCuit(p.cuit)})
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Button onClick={reset}>{source === "arca" ? "Volver a importar" : "Importar otro archivo"}</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={loadPreview} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm text-muted">Archivo de ARCA (.xlsx)</span>
            <Input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setError(null);
              }}
              disabled={busy !== null}
              className="py-1.5"
            />
          </label>
          <Button type="submit" disabled={!file || busy !== null}>
            <Upload aria-hidden="true" className="size-4" />
            {busy === "preview" ? "Leyendo…" : "Ver vista previa"}
          </Button>
        </form>
      )}

      {!result && (
        <section aria-labelledby="sincronizar-arca" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h2 id="sincronizar-arca" className="text-sm font-semibold text-strong">
              {ARCA_UI_MESSAGES.titulo}
            </h2>
            <p className="text-sm text-muted">
              Trae los comprobantes {kind === "ventas" ? "emitidos" : "recibidos"} de «Mis Comprobantes» sin descargar el Excel. Te pide tu usuario y clave fiscal cada vez.
            </p>
            {!arca.configurado && <p className="text-sm text-muted">{ARCA_UI_MESSAGES.noConfigurada}</p>}
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setInfo(null);
              setDialogOpen(true);
            }}
            disabled={!arca.configurado || busy !== null || polling !== null}
            className="shrink-0"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            {ARCA_UI_MESSAGES.titulo}
          </Button>
        </section>
      )}

      {polling && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center" aria-live="polite">
          <InlineMessage tone="info">{ARCA_UI_MESSAGES.consultando}</InlineMessage>
          <Button
            variant="secondary"
            onClick={() => {
              setPolling(null);
              setInfo(ARCA_UI_MESSAGES.cancelado);
            }}
          >
            {ARCA_UI_MESSAGES.dejarDeConsultar}
          </Button>
        </div>
      )}

      {arca.configurado && (
        <ArcaSyncDialog
          open={dialogOpen}
          kind={kind}
          today={hoy}
          onCancel={() => setDialogOpen(false)}
          onStarted={(syncId) => {
            setDialogOpen(false);
            setPreview(null);
            setSync(null);
            setResult(null);
            setPolling(syncId);
          }}
        />
      )}

      {preview && ctx && (
        <section aria-labelledby="vista-previa" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="vista-previa" className="text-lg font-semibold text-strong">
              Vista previa
            </h2>
            <p className="text-sm text-muted" aria-live="polite">
              {preview.resumen.total} filas · {preview.resumen.nuevas} nuevas · {preview.resumen.yaImportadas} ya importadas ·{" "}
              {preview.resumen.duplicadas} duplicadas en el archivo · {preview.resumen.conError} con error
              {kind === "compras" ? ` · ${preview.proveedoresNuevos.length} proveedores nuevos` : ""}
            </p>
          </div>
          {kind === "ventas" && !ctx.categoriaVentasPorDefecto.id && (
            <InlineMessage tone="info">
              El Parámetro «Categoría por defecto en Ventas» no apunta a una categoría existente: las filas sin categoría quedan con «{MENSAJES.categoriaInexistente}».
            </InlineMessage>
          )}
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>{source === "arca" ? "N.º" : "Fila"}</TableHeaderCell>
                <TableHeaderCell>Estado</TableHeaderCell>
                <TableHeaderCell>Fecha</TableHeaderCell>
                <TableHeaderCell>Comprobante</TableHeaderCell>
                <TableHeaderCell>{kind === "ventas" ? "Receptor" : "Emisor"}</TableHeaderCell>
                <TableHeaderCell>Moneda</TableHeaderCell>
                <TableHeaderCell className="text-right">Imp. Total</TableHeaderCell>
                <TableHeaderCell className="text-right">Total $</TableHeaderCell>
                <TableHeaderCell className="text-right">IVA $</TableHeaderCell>
                <TableHeaderCell className="text-right">Neto $</TableHeaderCell>
                {kind === "compras" && <TableHeaderCell className="text-right">Impacto $</TableHeaderCell>}
                <TableHeaderCell>{kind === "ventas" ? "Cliente" : "Proveedor"}</TableHeaderCell>
                <TableHeaderCell>Control</TableHeaderCell>
                <TableHeaderCell>Mes devengado</TableHeaderCell>
                <TableHeaderCell>Proyecto</TableHeaderCell>
                <TableHeaderCell>Unidad de negocio</TableHeaderCell>
                <TableHeaderCell>Categoría</TableHeaderCell>
                {kind === "compras" && <TableHeaderCell>Imputar a socio</TableHeaderCell>}
                <TableHeaderCell>Observaciones</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableEmpty colSpan={kind === "ventas" ? 18 : 20}>{source === "arca" ? "ARCA no devolvió comprobantes." : "El archivo no tiene comprobantes."}</TableEmpty>
              ) : (
                rows.map(({ f, ed, ev }) => {
                  const editable = f.estado === "nueva" && !!f.clave && busy === null;
                  const d = f.datos;
                  const doc = String(kind === "ventas" ? (d.nroDocReceptor ?? "") : (d.nroDocEmisor ?? ""));
                  const contraparte = String(kind === "ventas" ? (d.denominacionReceptor ?? "") : (d.denominacionEmisor ?? ""));
                  const sel = (key: keyof Ediciones) => (v: string) => setEdit(f.clave!, key, v);
                  const fixed = "min-w-40";
                  return (
                    <TableRow key={`${f.fila}`}>
                      <TableCell className="tabular-nums text-muted">{f.fila}</TableCell>
                      <TableCell className={cn("whitespace-nowrap", ESTADO_CLASS[f.estado])}>
                        {ESTADO_LABEL[f.estado]}
                        {f.error && <span className="block text-xs">{f.error}</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{typeof d.fecha === "string" ? displayDate(d.fecha) : ""}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {String(d.tipo ?? "")}
                        <span className="block text-xs text-muted tabular-nums">
                          {String(d.puntoVenta ?? "")}-{String(d.numeroDesde ?? "")}
                        </span>
                      </TableCell>
                      <TableCell className="min-w-48">
                        {contraparte}
                        <span className="block text-xs text-muted tabular-nums">{formatCuit(doc)}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {String(d.moneda ?? "") || "$"}
                        {typeof d.tipoCambio === "number" && d.tipoCambio > 0 && (
                          <span className="block text-xs text-muted tabular-nums">TC {formatNumber(d.tipoCambio, { maxDecimals: 4 })}</span>
                        )}
                      </TableCell>
                      <TableCell numeric>{importe(d.impTotal)}</TableCell>
                      <TableCell numeric>{f.estado === "error" ? "" : pesos(f.importes.total)}</TableCell>
                      <TableCell numeric>{f.estado === "error" ? "" : pesos(f.importes.iva)}</TableCell>
                      <TableCell numeric>{f.estado === "error" ? "" : pesos(f.importes.neto)}</TableCell>
                      {kind === "compras" && <TableCell numeric>{f.estado === "error" ? "" : pesos(ev.impactoResultados)}</TableCell>}
                      <TableCell className="min-w-40">
                        {kind === "ventas"
                          ? ev.cliente?.nombre ?? <span className="text-muted">—</span>
                          : f.proveedor && (
                              <>
                                {f.proveedor.nombre}
                                {!f.proveedor.id && <span className="block text-xs text-accent-text">Proveedor nuevo</span>}
                              </>
                            )}
                      </TableCell>
                      <TableCell className={cn("min-w-40", f.estado !== "error" && ev.control !== MENSAJES.ok && "text-danger")}>
                        {f.estado === "error" ? "" : ev.control}
                      </TableCell>
                      {editable ? (
                        <>
                          <TableCell className="min-w-36">
                            <MesAnioInput
                              label={`Mes devengado, ${filaLabel(f.fila)}`}
                              value={ed.mesDevengado ?? (f.mesFecha ?? "").slice(0, 7)}
                              onChange={(v) => setMesDevengado(f.clave!, v)}
                              className="min-w-60"
                            />
                          </TableCell>
                          <TableCell className={fixed}>
                            <Select aria-label={`Proyecto, ${filaLabel(f.fila)}`} value={ed.proyecto ?? ""} onChange={(e) => sel("proyecto")(e.target.value)} placeholder="Sin proyecto" options={proyectoOpts} />
                          </TableCell>
                          <TableCell className={fixed}>
                            <Select
                              aria-label={`Unidad de negocio, ${filaLabel(f.fila)}`}
                              value={ed.unidadNegocio ?? ""}
                              onChange={(e) => sel("unidadNegocio")(e.target.value)}
                              placeholder={ev.proyecto?.unidadNegocio ? `Del proyecto: ${nombreDe(ctx.unidades, ev.proyecto.unidadNegocio)}` : "—"}
                              options={unidadOpts}
                            />
                          </TableCell>
                          <TableCell className={fixed}>
                            {kind === "ventas" ? (
                              <Select
                                aria-label={`Categoría, ${filaLabel(f.fila)}`}
                                value={ed.categoria ?? ""}
                                onChange={(e) => sel("categoria")(e.target.value)}
                                placeholder={ctx.categoriaVentasPorDefecto.nombre ? `Por defecto: ${ctx.categoriaVentasPorDefecto.nombre}` : "Sin categoría"}
                                options={categoriaOpts}
                              />
                            ) : (
                              <Select
                                aria-label={`Categoría, ${filaLabel(f.fila)}`}
                                value={ed.categoria ?? f.proveedor?.categoriaPorDefecto ?? ""}
                                onChange={(e) => sel("categoria")(e.target.value)}
                                placeholder="Sin categoría"
                                options={categoriaOpts}
                              />
                            )}
                          </TableCell>
                          {kind === "compras" && (
                            <TableCell className={fixed}>
                              <Select aria-label={`Imputar a socio, ${filaLabel(f.fila)}`} value={ed.socio ?? ""} onChange={(e) => sel("socio")(e.target.value)} placeholder="No" options={socioOpts} />
                            </TableCell>
                          )}
                          <TableCell className="min-w-48">
                            <Input
                              aria-label={`Observaciones, ${filaLabel(f.fila)}`}
                              value={ed.observaciones ?? ""}
                              maxLength={OBSERVACIONES_MAX}
                              onChange={(e) => sel("observaciones")(e.target.value)}
                            />
                          </TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={kind === "ventas" ? 5 : 6} className="text-muted">
                          {f.estado === "nueva" ? "" : "No se importa"}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={confirm} disabled={busy !== null || nuevas === 0}>
              {busy === "confirm" ? "Importando…" : nuevas === 1 ? "Importar 1 comprobante" : `Importar ${nuevas} comprobantes`}
            </Button>
            <Button variant="secondary" onClick={reset} disabled={busy !== null}>
              Cancelar
            </Button>
            {nuevas === 0 && <p className="text-sm text-muted">No hay comprobantes nuevos para importar.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
