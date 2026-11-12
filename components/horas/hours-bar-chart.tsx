"use client";

import { useState } from "react";

import { formatHours } from "@/lib/horas/time";

export interface BarDatum {
  key: string;
  label: string;
  value: number;
}

const HEIGHT = 220;
const PAD = { top: 24, right: 12, bottom: 36, left: 48 };
const MIN_BAR_SLOT = 28;

/** Escala "linda" para el eje Y: 1, 2, 2,5 o 5 × 10^n. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= max) return m * exp;
  return 10 * exp;
}

/**
 * Barras de horas por período, en SVG a mano (sin librería). Cada barra es
 * enfocable, tiene nombre accesible ("Sem 03/11: 12,50 h") y muestra el valor
 * al pasar el mouse o con foco. La tabla de abajo es el equivalente accesible.
 */
export function HoursBarChart({ data, title }: { data: readonly BarDatum[]; title: string }) {
  const [active, setActive] = useState<string | null>(null);
  const slot = MIN_BAR_SLOT;
  const width = Math.max(480, PAD.left + PAD.right + data.length * slot);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const step = plotW / Math.max(1, data.length);
  const barW = Math.max(4, Math.min(40, step * 0.7));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  // Etiquetas del eje X: como mucho ~16 visibles.
  const every = Math.max(1, Math.ceil(data.length / 16));

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-line bg-card p-3">
      <svg role="group" aria-label={title} width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--color-muted)">
              {formatHours(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + step * i + step / 2;
          const h = Math.max(0, PAD.top + plotH - y(d.value));
          const isActive = active === d.key;
          const name = `${d.label}: ${formatHours(d.value)} h`;
          return (
            <g key={d.key}>
              <rect
                role="img"
                aria-label={name}
                tabIndex={0}
                x={cx - barW / 2}
                y={y(d.value)}
                width={barW}
                height={h}
                rx={2}
                fill="var(--color-accent)"
                opacity={active && !isActive ? 0.55 : 1}
                onMouseEnter={() => setActive(d.key)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(d.key)}
                onBlur={() => setActive(null)}
                className="outline-none focus-visible:stroke-white focus-visible:[stroke-width:2]"
              >
                <title>{name}</title>
              </rect>
              {isActive && (
                <text x={cx} y={y(d.value) - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--color-white)" aria-hidden="true">
                  {formatHours(d.value)}
                </text>
              )}
              {i % every === 0 && (
                <text x={cx} y={HEIGHT - PAD.bottom + 16} textAnchor="middle" fontSize="11" fill="var(--color-muted)" aria-hidden="true">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--color-muted)" />
      </svg>
    </div>
  );
}
