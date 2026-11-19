"use client";

import { Download, FileCheck2, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Checkbox, ConfirmDialog, InlineMessage, Input } from "@/components/ui";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatNumber, isoToDisplayDate } from "@/lib/format";
import { DETALLE_MAX, FACTURA_MESSAGES, moneyAr, n8, pv5, type ComprobanteVista, type FacturaEstado } from "@/lib/factura/factura";

export const FACTURA_UI_MESSAGES = {
  titulo: "Factura ARCA",
  activar: "Emitir factura en ARCA para este cliente y mes",
  faltan: "Para emitir la factura en ARCA falta resolver:",
  difiere: "La factura incluye sólo las horas facturables en Pendiente y en pesos: difiere de la proforma.",
  emitir: "Emitir factura",
  emitiendo: "Emitiendo…",
  confirmarTitulo: "¿Emitir la factura A en ARCA?",
  irreversible: "Esta acción no se puede deshacer: ARCA emite la factura con su CAE y queda registrada.",
  vencimiento: "Elegí un vencimiento de pago igual o posterior a hoy.",
  detalle: `Escribí el detalle (hasta ${DETALLE_MAX} caracteres).`,
  red: "No pudimos conectarnos. Revisá tu conexión y probá de nuevo.",
  error: "Ocurrió un error. Probá de nuevo.",
  sinComprobantes: "Todavía no hay comprobantes emitidos para este cliente y mes.",
  verificar: "Verificar en ARCA",
  completar: "Completar registro",
} as const;

const pesos = (cents: number) => `$ ${moneyAr(cents)}`;

function AmbienteBadge({ ambiente }: { ambiente: FacturaEstado["ambiente"] }) {
  const prod = ambiente === "Producción";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        prod ? "border-danger/40 bg-danger/10 text-danger" : "border-line bg-surface text-muted",
      )}
    >
      {prod ? "Producción" : "Homologación · sin validez fiscal"}
    </span>
  );
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, json };
}

export interface FacturaArcaProps {
  cliente: { id: string; nombre: string };
  mes: string;
  mesLabel: string;
  initial: FacturaEstado;
}

/**
 * «Factura ARCA» en la Proforma (CC-F5-10). Opcional: la proforma sigue igual. El servidor
 * revalida todo y calcula los importes; acá solo se eligen el vencimiento de pago y el detalle.
 */
export function FacturaArca({ cliente, mes, mesLabel, initial }: FacturaArcaProps) {
  const [estado, setEstado] = useState(initial);
  const [activa, setActiva] = useState(false);
  const [vencimiento, setVencimiento] = useState("");
  const [detalle, setDetalle] = useState(initial.detalleSugerido);
  const [confirmar, setConfirmar] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);

  async function recargar() {
    try {
      const res = await fetch(`/api/admin/facturas?cliente=${encodeURIComponent(cliente.id)}&mes=${encodeURIComponent(mes)}`, { cache: "no-store" });
      const json = (await res.json()) as FacturaEstado & { ok?: boolean; error?: string };
      if (res.ok) setEstado(json);
    } catch {
      // se queda con lo último
    }
  }

  function validar(): string | null {
    if (!vencimiento || vencimiento < estado.hoy) return FACTURA_UI_MESSAGES.vencimiento;
    const d = detalle.trim();
    if (!d || d.length > DETALLE_MAX) return FACTURA_UI_MESSAGES.detalle;
    return null;
  }

  async function emitir() {
    setBusy("emitir");
    setError(null);
    try {
      const { ok, json } = await post("/api/admin/facturas/emitir", { cliente: cliente.id, mes, vencimientoPago: vencimiento, detalle: detalle.trim() });
      setConfirmar(false);
      if (!ok) setError(typeof json.error === "string" ? json.error : FACTURA_UI_MESSAGES.error);
      else {
        const est = json.estado as string;
        const msg = typeof json.mensaje === "string" ? json.mensaje : null;
        setAviso({ tone: est === "Autorizada" ? "success" : est === "Rechazada" ? "danger" : "info", text: `Factura ${est}.${msg ? ` ${msg}` : ""}` });
        setActiva(false);
      }
    } catch {
      setConfirmar(false);
      setError(FACTURA_UI_MESSAGES.red);
    } finally {
      setBusy(null);
      await recargar();
    }
  }

  async function accion(c: ComprobanteVista, tipo: "verificar" | "completar") {
    setBusy(`${tipo}:${c.id}`);
    setAviso(null);
    try {
      const { ok, json } = await post(`/api/admin/facturas/${c.id}/${tipo}`, {});
      if (!ok) setAviso({ tone: "danger", text: typeof json.error === "string" ? json.error : FACTURA_UI_MESSAGES.error });
      else {
        const msg = typeof json.mensaje === "string" ? json.mensaje : null;
        setAviso({ tone: json.estado === "Autorizada" ? "success" : "info", text: `Factura ${String(json.estado)}.${msg ? ` ${msg}` : ""}` });
      }
    } catch {
      setAviso({ tone: "danger", text: FACTURA_UI_MESSAGES.red });
    } finally {
      setBusy(null);
      await recargar();
    }
  }

  const err = activa ? validar() : null;

  return (
    <section aria-labelledby="factura-arca" className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="factura-arca" className="text-lg font-semibold text-strong">
          {FACTURA_UI_MESSAGES.titulo}
        </h2>
        <AmbienteBadge ambiente={estado.ambiente} />
      </div>

      {aviso && <InlineMessage tone={aviso.tone}>{aviso.text}</InlineMessage>}

      {!estado.elegible ? (
        <InlineMessage tone="info" title={FACTURA_UI_MESSAGES.faltan}>
          <ul className="list-disc pl-5">
            {estado.motivos.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </InlineMessage>
      ) : (
        <div className="flex flex-col gap-4">
          <Checkbox label={FACTURA_UI_MESSAGES.activar} checked={activa} onChange={(e) => setActiva(e.target.checked)} disabled={busy !== null} />
          {activa && (
            <div className="flex flex-col gap-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                {[
                  ["Neto gravado", pesos(estado.importes.neto)],
                  [`IVA ${formatNumber(estado.alicuota * 100, { maxDecimals: 2 })} %`, pesos(estado.importes.iva)],
                  ["Total de la factura", pesos(estado.importes.total)],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-1">
                    <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
                    <dd className="font-medium tabular-nums text-strong">{v}</dd>
                  </div>
                ))}
              </dl>
              {estado.difiere && (
                <InlineMessage tone="info">
                  {FACTURA_UI_MESSAGES.difiere} Proforma: {estado.proformaTotales.map((t) => `${t.moneda} ${moneyAr(t.total)}`).join(" · ")}.
                </InlineMessage>
              )}
              <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
                <label className="flex flex-col gap-1 text-sm text-text">
                  Vencimiento de pago
                  <Input type="date" min={estado.hoy} value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} disabled={busy !== null} />
                </label>
                <label className="flex flex-col gap-1 text-sm text-text">
                  Detalle
                  <Input value={detalle} maxLength={DETALLE_MAX} onChange={(e) => setDetalle(e.target.value)} disabled={busy !== null} />
                </label>
              </div>
              {err && <p className="text-sm text-muted">{err}</p>}
              {error && <InlineMessage tone="danger">{error}</InlineMessage>}
              <div>
                <button type="button" className={buttonClasses("primary", "md", "gap-2")} disabled={err !== null || busy !== null} onClick={() => setConfirmar(true)}>
                  <FileCheck2 aria-hidden="true" className="size-4" />
                  {FACTURA_UI_MESSAGES.emitir}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-strong">Comprobantes emitidos · {mesLabel}</h3>
        {estado.comprobantes.length === 0 ? (
          <p className="text-sm text-muted">{FACTURA_UI_MESSAGES.sinComprobantes}</p>
        ) : (
          <div className="w-full overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  {["Comprobante", "Estado", "Ambiente", "Número", "CAE", "Total", ""].map((h, i) => (
                    <th key={i} scope="col" className={cn("whitespace-nowrap px-4 py-3 font-medium", h === "Total" && "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-card">
                {estado.comprobantes.map((c) => (
                  <tr key={c.id} className="align-top">
                    <td className="px-4 py-2">
                      <div className="font-medium text-strong">{c.label}</div>
                      {c.pendienteRegistro && <div className="text-xs font-medium text-danger">{FACTURA_MESSAGES.faltaRegistro}</div>}
                      {c.datosIncompletos && <div className="text-xs font-medium text-danger">{FACTURA_MESSAGES.datosIncompletos}</div>}
                      {c.mensaje && <div className="whitespace-pre-line text-xs text-muted">{c.mensaje}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">{c.estado ?? ""}</td>
                    <td className="whitespace-nowrap px-4 py-2">{c.ambiente ?? ""}</td>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums">{c.puntoVenta !== null && c.numero !== null ? `${pv5(c.puntoVenta)}-${n8(c.numero)}` : ""}</td>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums">
                      {c.cae ?? ""}
                      {c.vencimientoCae && <div className="text-xs text-muted">Vence {isoToDisplayDate(c.vencimientoCae)}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{c.total !== null ? pesos(c.total) : ""}</td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <div className="flex flex-wrap justify-end gap-2">
                        {c.pdf && (
                          <a href={`/api/admin/facturas/${c.id}/pdf`} className={buttonClasses("secondary", "sm", "gap-1")} download>
                            <Download aria-hidden="true" className="size-4" />
                            PDF
                          </a>
                        )}
                        {c.verificable && (
                          <button type="button" className={buttonClasses("secondary", "sm", "gap-1")} disabled={busy !== null} onClick={() => accion(c, "verificar")}>
                            <RefreshCw aria-hidden="true" className="size-4" />
                            {busy === `verificar:${c.id}` ? "Verificando…" : FACTURA_UI_MESSAGES.verificar}
                          </button>
                        )}
                        {c.completable && (
                          <button type="button" className={buttonClasses("secondary", "sm")} disabled={busy !== null} onClick={() => accion(c, "completar")}>
                            {busy === `completar:${c.id}` ? "Completando…" : FACTURA_UI_MESSAGES.completar}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmar}
        title={FACTURA_UI_MESSAGES.confirmarTitulo}
        confirmLabel={FACTURA_UI_MESSAGES.emitir}
        busy={busy === "emitir"}
        busyLabel={FACTURA_UI_MESSAGES.emitiendo}
        destructive={false}
        confirmVariant="primary"
        onConfirm={emitir}
        onCancel={() => setConfirmar(false)}
      >
        <p className="font-medium text-strong">{FACTURA_UI_MESSAGES.irreversible}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Ambiente</dt>
          <dd>{estado.ambiente}</dd>
          <dt className="text-muted">Cliente</dt>
          <dd>{cliente.nombre}</dd>
          <dt className="text-muted">Mes</dt>
          <dd>{mesLabel}</dd>
          <dt className="text-muted">Total</dt>
          <dd className="tabular-nums">{pesos(estado.importes.total)}</dd>
          <dt className="text-muted">Vencimiento de pago</dt>
          <dd>{vencimiento ? isoToDisplayDate(vencimiento) : ""}</dd>
        </dl>
      </ConfirmDialog>
    </section>
  );
}
