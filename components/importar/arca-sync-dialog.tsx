"use client";

import { useRef, useState } from "react";

import { ConfirmDialog, FormField, InlineMessage, Input } from "@/components/ui";
import { isValidCuit } from "@/lib/cuit";
import { daysBetween } from "@/lib/horas/dates";
import { KIND_LABEL, type Kind } from "@/lib/ventas-compras/columns";

export const ARCA_DIALOG_MESSAGES = {
  nota: "La clave se usa sólo para esta sincronización y no se guarda.",
  fechas: "Elegí las fechas Desde y Hasta.",
  orden: "La fecha Desde no puede ser posterior a Hasta.",
  futuro: "La fecha Hasta no puede ser posterior a hoy.",
  rango: "El período no puede superar los 366 días.",
  usuario: "El usuario de ARCA tiene que ser una CUIT válida.",
  clave: "Escribí la clave fiscal.",
  red: "No pudimos conectarnos. Revisá tu conexión y probá de nuevo.",
  error: "Ocurrió un error. Probá de nuevo.",
} as const;

/** Validación previa (el servidor vuelve a validar todo). null = OK. */
export function validarFormulario(v: { desde: string; hasta: string; usuario: string; clave: string }, today: string): string | null {
  if (!v.desde || !v.hasta) return ARCA_DIALOG_MESSAGES.fechas;
  if (v.desde > v.hasta) return ARCA_DIALOG_MESSAGES.orden;
  if (v.hasta > today) return ARCA_DIALOG_MESSAGES.futuro;
  if (daysBetween(v.desde, v.hasta) > 365) return ARCA_DIALOG_MESSAGES.rango;
  if (!isValidCuit(v.usuario)) return ARCA_DIALOG_MESSAGES.usuario;
  if (!v.clave) return ARCA_DIALOG_MESSAGES.clave;
  return null;
}

/**
 * Diálogo «Sincronizar con ARCA» (CC-F5-03): período, usuario ARCA (CUIT) y clave fiscal.
 * Las credenciales solo viven en este estado y en el body del POST: se borran apenas vuelve
 * la respuesta (éxito o error) y al cancelar. Nunca van a la URL ni a localStorage.
 */
export function ArcaSyncDialog({
  open,
  kind,
  today,
  onCancel,
  onStarted,
}: {
  open: boolean;
  kind: Kind;
  today: string;
  onCancel: () => void;
  onStarted: (syncId: string) => void;
}) {
  const [desde, setDesde] = useState(`${today.slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(today);
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  const clearCredentials = () => {
    setUsuario("");
    setClave("");
  };

  async function submit() {
    const invalid = validarFormulario({ desde, hasta, usuario, clave }, today);
    if (invalid) return setError(invalid);
    setError(null);
    setBusy(true);
    let res: { ok: true; syncId: string } | { ok: false; error: string };
    try {
      const response = await fetch(`/api/admin/arca/${kind}/sincronizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desde, hasta, usuario, clave }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as { syncId?: unknown; error?: unknown };
      res = response.ok && typeof data.syncId === "string" ? { ok: true, syncId: data.syncId } : { ok: false, error: typeof data.error === "string" ? data.error : ARCA_DIALOG_MESSAGES.error };
    } catch {
      res = { ok: false, error: ARCA_DIALOG_MESSAGES.red };
    } finally {
      // Las credenciales se borran siempre, salga bien o mal.
      clearCredentials();
      setBusy(false);
    }
    if (res.ok) onStarted(res.syncId);
    else setError(res.error);
  }

  return (
    <ConfirmDialog
      open={open}
      title={`Sincronizar ${KIND_LABEL[kind].titulo.toLowerCase()} con ARCA`}
      confirmLabel="Sincronizar"
      busy={busy}
      busyLabel="Conectando con ARCA…"
      destructive={false}
      confirmVariant="primary"
      initialFocus={first}
      onConfirm={submit}
      onCancel={() => {
        clearCredentials();
        setError(null);
        onCancel();
      }}
    >
      <div className="flex flex-col gap-3 text-text">
        <p className="text-muted">
          Trae los comprobantes {kind === "ventas" ? "emitidos" : "recibidos"} de «Mis Comprobantes» para el período elegido.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Desde">
            <Input ref={first} type="date" value={desde} max={today} onChange={(e) => setDesde(e.target.value)} disabled={busy} />
          </FormField>
          <FormField label="Hasta">
            <Input type="date" value={hasta} max={today} onChange={(e) => setHasta(e.target.value)} disabled={busy} />
          </FormField>
        </div>
        <FormField label="Usuario ARCA (CUIT)">
          <Input value={usuario} inputMode="numeric" autoComplete="off" spellCheck={false} onChange={(e) => setUsuario(e.target.value)} disabled={busy} />
        </FormField>
        <FormField label="Clave fiscal">
          <Input type="password" value={clave} autoComplete="off" onChange={(e) => setClave(e.target.value)} disabled={busy} />
        </FormField>
        <p className="text-xs text-muted">{ARCA_DIALOG_MESSAGES.nota}</p>
        {error && <InlineMessage tone="danger">{error}</InlineMessage>}
      </div>
    </ConfirmDialog>
  );
}
