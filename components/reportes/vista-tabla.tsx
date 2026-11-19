import { InlineMessage } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { formatHours } from "@/lib/horas/time";
import { kindDe, type ColumnKind, type VistaTabla } from "@/lib/reportes/vista";

/** Una tabla de una vista (lib/reportes/vista.ts). La usan los reportes y la vista Cliente. */
/** Valor de una celda en pantalla (es-AR; negativos con signo menos, sin color). */
export function mostrar(kind: ColumnKind, v: string | number | null): string {
  if (v === null || v === "") return "";
  if (typeof v === "string") return v;
  if (kind === "money") return formatNumber(v / 100, { decimals: 2 });
  if (kind === "pct") return `${formatNumber(v * 100, { decimals: 1 })} %`;
  if (kind === "hours") return formatHours(v);
  return String(v);
}

export function Tabla({ tabla }: { tabla: VistaTabla }) {
  return (
    <section className="flex flex-col gap-2">
      {tabla.titulo && <h2 className="text-lg font-semibold text-strong">{tabla.titulo}</h2>}
      {tabla.error ? (
        <InlineMessage tone="danger">{tabla.error}</InlineMessage>
      ) : (
        <div className="w-full overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                {tabla.columnas.map((c, i) => (
                  <th key={i} scope="col" className={cn("whitespace-nowrap px-4 py-3 font-medium", c.kind !== "text" && "text-right", i === 0 && "sticky left-0 z-10 bg-surface")}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-card">
              {tabla.filas.map((f, r) => (
                <tr key={r} className={cn(f.total && "bg-surface font-semibold text-strong", f.seccion && "text-xs uppercase tracking-wide text-muted")}>
                  {tabla.columnas.map((c, i) => {
                    const kind = kindDe(c, f);
                    const first = i === 0;
                    return (
                      <td
                        key={i}
                        className={cn("whitespace-nowrap px-4 py-2", kind !== "text" && "text-right tabular-nums", first && cn("sticky left-0 z-10", f.total ? "bg-surface" : "bg-card"))}
                      >
                        {f.seccion && !first ? "" : mostrar(kind, f.cells[i] ?? null)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
