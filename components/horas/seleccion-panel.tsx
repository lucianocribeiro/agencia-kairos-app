"use client";

import { useState } from "react";

import { Button, Card, CardContent, CardHeader, CardTitle, InlineMessage } from "@/components/ui";
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

/** Resumen de las horas seleccionadas (importe como la Proforma) con Excel y «Limpiar selección». */
export function SeleccionPanel({
  ids,
  data,
  error,
  loading,
  onClear,
}: {
  ids: readonly string[];
  data: SeleccionData | null;
  error: string | null;
  loading: boolean;
  onClear: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
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
          <Button variant="secondary" onClick={onClear}>
            Limpiar selección
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
