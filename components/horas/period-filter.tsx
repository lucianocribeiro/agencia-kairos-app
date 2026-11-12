"use client";

import { FormField, Input } from "@/components/ui";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { PERIOD_SHORTCUTS, shortcutRange, type DateRange, type PeriodShortcut } from "@/lib/horas/dates";

/** Período desde/hasta (inputs de fecha nativos, "YYYY-MM-DD") con atajos. */
export function PeriodFilter({
  value,
  onChange,
  today,
  shortcuts,
  disabled,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** Hoy en Buenos Aires (lo calcula el servidor). */
  today: string;
  shortcuts: readonly PeriodShortcut[];
  disabled?: boolean;
}) {
  const active = shortcuts.find((s) => {
    const r = shortcutRange(s, today);
    return r.desde === value.desde && r.hasta === value.hasta;
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:w-80">
        <FormField label="Desde">
          <Input type="date" value={value.desde} max={value.hasta} onChange={(e) => e.target.value && onChange({ ...value, desde: e.target.value })} disabled={disabled} />
        </FormField>
        <FormField label="Hasta">
          <Input type="date" value={value.hasta} min={value.desde} onChange={(e) => e.target.value && onChange({ ...value, hasta: e.target.value })} disabled={disabled} />
        </FormField>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Atajos de período">
        {shortcuts.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={active === s}
            disabled={disabled}
            onClick={() => onChange(shortcutRange(s, today))}
            className={cn(buttonClasses(active === s ? "secondary" : "ghost", "sm"), active === s && "text-accent")}
          >
            {PERIOD_SHORTCUTS[s]}
          </button>
        ))}
      </div>
    </div>
  );
}
