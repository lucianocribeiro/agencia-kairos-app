import { Download } from "lucide-react";

import { FacturaArca } from "@/components/factura/factura-arca";
import { InlineMessage } from "@/components/ui";
import { buttonClasses } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/control-classes";
import { MesAnioInput } from "@/components/ui/mes-anio-select";
import { cn } from "@/lib/cn";
import { formatNumber, isoToDisplayDate } from "@/lib/format";
import { formatHours } from "@/lib/horas/time";
import type { FacturaEstado } from "@/lib/factura/factura";
import { PROFORMA_MESSAGES, type ProformaData } from "@/lib/proforma/proforma";
import { equivalenteFilas, formatTipoCambio, TC_MESSAGES, tieneUsd } from "@/lib/proforma/tipo-cambio";

const money = (cents: number | null) => (cents === null ? "" : formatNumber(cents / 100, { decimals: 2 }));
const valor = (v: number | null) => (v === null ? "" : formatNumber(v, { decimals: 2 }));
const th = "whitespace-nowrap px-4 py-3 font-medium";
const td = "px-4 py-2";
const num = "text-right tabular-nums whitespace-nowrap";

function Tabla({ titulo, nota, head, children }: { titulo: string; nota?: string; head: { label: string; numeric?: boolean }[]; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-strong">{titulo}</h2>
      {nota && <p className="text-sm font-medium text-strong">{nota}</p>}
      <div className="w-full overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              {head.map((h, i) => (
                <th key={i} scope="col" className={cn(th, h.numeric && "text-right", i === 0 && "sticky left-0 z-10 bg-surface")}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-card">{children}</tbody>
        </table>
      </div>
    </section>
  );
}

export interface ProformaViewProps {
  clientes: { id: string; nombre: string }[];
  cliente: string | null;
  mes: string;
  data: ProformaData | null;
  error: string | null;
  /** «Factura ARCA» (CC-F5-10) del cliente + mes; null si no se pudo cargar. */
  factura?: FacturaEstado | null;
  /** Tipo de cambio tal como vino en `?tc=` (CC-F5-21) y su error, si es inválido. */
  tc?: string;
  tcError?: string | null;
}

/** Proforma de horas (Admin). Server component: el formulario es un GET (cliente y mes). */
export function ProformaView({ clientes, cliente, mes, data, error, factura = null, tc = "", tcError = null }: ProformaViewProps) {
  const cv = data?.conversion ?? null;
  const tcTexto = cv ? formatTipoCambio(cv.tipoCambio) : null;
  const pdf = data ? `/api/admin/proforma/pdf?cliente=${encodeURIComponent(data.cliente.id)}&mes=${data.mes}${tcTexto ? `&tc=${encodeURIComponent(tcTexto)}` : ""}` : null;
  const pideTc = data !== null && !data.vacia && tieneUsd(data.totales);
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-strong">Proforma de horas</h1>
        <div className="flex flex-wrap items-end gap-3">
          <form method="get" action="/reportes/proforma" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm text-text">
              Cliente
              <select name="cliente" defaultValue={cliente ?? ""} required className={cn(controlClasses, "w-64")}>
                <option value="" disabled>
                  Elegí un cliente
                </option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <div role="group" aria-labelledby="proforma-mes" className="flex flex-col gap-1 text-sm text-text">
              <span id="proforma-mes">Mes a facturar</span>
              <MesAnioInput label="Mes a facturar" name="mes" defaultValue={mes} required className="w-60" />
            </div>
            <button type="submit" className={buttonClasses("secondary", "md")}>
              Ver
            </button>
          </form>
          {pdf && data && !data.vacia && (
            <a href={pdf} className={buttonClasses("primary", "md", "gap-2")} download>
              <Download aria-hidden="true" className="size-4" />
              Descargar PDF
            </a>
          )}
        </div>
      </div>

      {error && <InlineMessage tone="danger">{error}</InlineMessage>}

      {data && (
        <>
          <dl className="grid gap-4 rounded-lg border border-line bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Cliente", data.cliente.nombre],
              ["CUIT", data.cliente.cuit],
              ["Condición IVA", data.cliente.condicionIva],
              ["Mes a facturar", data.mesLabel],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1">
                <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
                <dd className="font-medium text-strong">{v}</dd>
              </div>
            ))}
          </dl>

          {pideTc && (
            <form method="get" action="/reportes/proforma" className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4">
              <input type="hidden" name="cliente" value={data.cliente.id} />
              <input type="hidden" name="mes" value={data.mes} />
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm text-text">
                  {TC_MESSAGES.label}
                  <input
                    name="tc"
                    inputMode="decimal"
                    autoComplete="off"
                    defaultValue={tcTexto ?? tc}
                    aria-invalid={tcError ? true : undefined}
                    aria-describedby={tcError ? "proforma-tc-error" : undefined}
                    className={cn(controlClasses, "w-48 text-right tabular-nums")}
                  />
                </label>
                <button type="submit" className={buttonClasses("secondary", "md")}>
                  Convertir a pesos
                </button>
              </div>
              {tcError && (
                <p id="proforma-tc-error" className="text-sm text-danger">
                  {tcError}
                </p>
              )}
            </form>
          )}

          {factura && <FacturaArca cliente={{ id: data.cliente.id, nombre: data.cliente.nombre }} mes={data.mes} mesLabel={data.mesLabel} initial={factura} tipoCambio={tcTexto} />}

          {data.vacia ? (
            <InlineMessage tone="info">{PROFORMA_MESSAGES.vacia(data.mesLabel)}</InlineMessage>
          ) : (
            <>
              {data.incompleta && <InlineMessage tone="danger">{PROFORMA_MESSAGES.incompleta}</InlineMessage>}
              <Tabla
                titulo="Resumen por proyecto"
                head={[{ label: "Proyecto" }, { label: "Horas", numeric: true }, { label: "Valor hora", numeric: true }, { label: "Moneda" }, { label: "Importe", numeric: true }, { label: "Observación" }]}
              >
                {data.proyectos.map((p) => (
                  <tr key={p.id}>
                    <td className={cn(td, "sticky left-0 z-10 bg-card whitespace-nowrap")}>{p.codigo}</td>
                    <td className={cn(td, num)}>{formatHours(p.horas)}</td>
                    <td className={cn(td, num)}>{valor(p.valorHora)}</td>
                    <td className={td}>{p.moneda ?? ""}</td>
                    <td className={cn(td, num)}>{money(p.importe)}</td>
                    <td className={cn(td, p.aviso && "text-danger")}>{p.aviso ?? ""}</td>
                  </tr>
                ))}
              </Tabla>
              <Tabla titulo={`Totales por moneda (${data.alicuotaLabel})`} head={[{ label: "Moneda" }, { label: "Subtotal", numeric: true }, { label: data.alicuotaLabel, numeric: true }, { label: "Total", numeric: true }]}>
                {data.totales.map((t) => (
                  <tr key={t.moneda} className="bg-surface font-semibold text-strong">
                    <td className={cn(td, "sticky left-0 z-10 bg-surface")}>{t.moneda}</td>
                    <td className={cn(td, num)}>{money(t.subtotal)}</td>
                    <td className={cn(td, num)}>{money(t.iva)}</td>
                    <td className={cn(td, num)}>{money(t.total)}</td>
                  </tr>
                ))}
              </Tabla>
              {cv && (
                <Tabla titulo="Equivalente en pesos" nota={`Tipo de cambio: ${formatTipoCambio(cv.tipoCambio)}`} head={[{ label: "Concepto" }, { label: "ARS", numeric: true }]}>
                  {equivalenteFilas(cv, data.alicuotaLabel).map((f) => (
                    <tr key={f.label} className={cn(f.destacado && "bg-surface font-semibold text-strong")}>
                      <td className={cn(td, "sticky left-0 z-10", f.destacado ? "bg-surface" : "bg-card")}>{f.label}</td>
                      <td className={cn(td, num)}>{money(f.cents)}</td>
                    </tr>
                  ))}
                </Tabla>
              )}
              <Tabla
                titulo="Detalle de horas"
                head={[
                  { label: "Fecha" },
                  { label: "Colaborador" },
                  { label: "Proyecto" },
                  { label: "Tarea" },
                  { label: "Horas", numeric: true },
                  { label: "Valor hora", numeric: true },
                  { label: "Moneda" },
                  { label: "Importe", numeric: true },
                ]}
              >
                {data.detalle.map((r) => (
                  <tr key={r.id}>
                    <td className={cn(td, "sticky left-0 z-10 bg-card whitespace-nowrap")}>{isoToDisplayDate(r.fecha)}</td>
                    <td className={cn(td, "whitespace-nowrap")}>{r.colaborador}</td>
                    <td className={cn(td, "whitespace-nowrap")}>{r.proyecto}</td>
                    <td className={cn(td, "min-w-64")}>{r.tarea}</td>
                    <td className={cn(td, num)}>{formatHours(r.horas)}</td>
                    <td className={cn(td, num)}>{valor(r.valorHora)}</td>
                    <td className={td}>{r.moneda ?? ""}</td>
                    <td className={cn(td, num)}>{money(r.importe)}</td>
                  </tr>
                ))}
              </Tabla>
            </>
          )}
        </>
      )}
    </div>
  );
}
