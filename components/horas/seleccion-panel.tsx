"use client";

import { useState } from "react";

import { callApi } from "@/components/abm/api";
import { Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, InlineMessage, useToast } from "@/components/ui";
import { ESTADO_MESSAGES, type EstadoFacturacion } from "@/lib/horas/estado";
import { formatNumber } from "@/lib/format";
import { SELECCION_MESSAGES, type SeleccionData } from "@/lib/horas/seleccion";
import { formatHours } from "@/lib/horas/time";

const money = (cents: number | null) => (cents === null ? SELECCION_MESSAGES.noDisponible : formatNumber(cents / 100, { decimals: 2 }));

/** Descarga el .xlsx de la selección (POST con los IDs). Devuelve un error o null. */
async function descargarExcel(ids: readonly string[]): Promise<string | null> {
  try {
    const res = await fetch("/api/admin/horas/seleccion/excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: unknown };
      return typeof data.error === "string" ? data.error : "No pudimos generar el Excel. Probá de nuevo.";
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "Seleccion.xlsx";
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return null;
  } catch {
    return "No pudimos conectarnos. Revisá tu conexión y probá de nuevo.";
  }
}

/**
 * Resumen de las horas seleccionadas (importe como la Proforma) con Excel, «Limpiar selección» y
 * (CC-F4-08) «Marcar como facturadas» / «Marcar como pagadas», con el diálogo de la app.
 */
export function SeleccionPanel({
  ids,
  data,
  error,
  loading,
  onClear,
  onEstadoCambiado,
}: {
  ids: readonly string[];
  data: SeleccionData | null;
  error: string | null;
  loading: boolean;
  onClear: () => void;
  /** Después de marcar: la lista se recarga (y la selección se limpia). */
  onEstadoCambiado?: () => void;
}) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [marcar, setMarcar] = useState<EstadoFacturacion | null>(null);
  const [marcando, setMarcando] = useState(false);
  const [marcarError, setMarcarError] = useState<string | null>(null);

  async function confirmarMarcar() {
    if (!marcar) return;
    const estado = marcar;
    setMarcando(true);
    const res = await callApi("POST", "/api/admin/horas/seleccion/estado", { ids, estado });
    setMarcando(false);
    setMarcar(null);
    if (!res.ok) return setMarcarError(res.error ?? "No pudimos cambiar el estado. Probá de nuevo.");
    setMarcarError(null);
    toast.success(ESTADO_MESSAGES.hecho(Number(res.data.actualizadas ?? ids.length), estado));
    onEstadoCambiado?.();
  }
  const items: [string, string][] = data
    ? [
        ["Proyecto", data.proyecto.codigo],
        ["Valor hora", data.valorHora === null ? "—" : formatNumber(data.valorHora, { decimals: 2 })],
        ["Moneda", data.moneda ?? "—"],
        ["Registros", String(data.registros)],
        ["Horas", formatHours(data.horas)],
        ["Neto", money(data.neto)],
        ["IVA", data.neto === null ? "—" : money(data.iva)],
        ["Total", data.neto === null ? "—" : money(data.total)],
      ]
    : [];

  return (
    <Card aria-live="polite" data-testid="seleccion-panel">
      <CardHeader>
        <CardTitle>Selección · {ids.length === 1 ? "1 registro" : `${ids.length} registros`}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <InlineMessage tone="danger">{error}</InlineMessage>}
        {downloadError && <InlineMessage tone="danger">{downloadError}</InlineMessage>}
        {marcarError && <InlineMessage tone="danger">{marcarError}</InlineMessage>}
        {data && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {items.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
                <dd className={label === "Total" ? "font-semibold text-white tabular-nums" : "text-text tabular-nums"}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {loading && !data && <p className="text-sm text-muted">Calculando…</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={async () => {
              setDownloading(true);
              setDownloadError(await descargarExcel(ids));
              setDownloading(false);
            }}
            disabled={!data || loading || downloading}
          >
            {downloading ? "Descargando…" : "Descargar Excel"}
          </Button>
          <Button variant="secondary" onClick={() => setMarcar("Facturada")} disabled={!data || loading || marcando}>
            Marcar como facturadas
          </Button>
          <Button variant="secondary" onClick={() => setMarcar("Pagada")} disabled={!data || loading || marcando}>
            Marcar como pagadas
          </Button>
          <Button variant="secondary" onClick={onClear}>
            Limpiar selección
          </Button>
        </div>
        <ConfirmDialog
          open={marcar !== null}
          title={marcar ? ESTADO_MESSAGES.confirmar(ids.length, marcar) : ""}
          confirmLabel={marcar === "Pagada" ? "Marcar como pagadas" : "Marcar como facturadas"}
          confirmVariant="primary"
          busy={marcando}
          busyLabel="Guardando…"
          onConfirm={confirmarMarcar}
          onCancel={() => setMarcar(null)}
        >
          Solo cambia el estado de facturación{data ? ` de las horas de ${data.proyecto.codigo}` : ""}.
        </ConfirmDialog>
      </CardContent>
    </Card>
  );
}
