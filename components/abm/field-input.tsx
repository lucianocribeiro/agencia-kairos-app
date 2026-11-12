"use client";

import { useId } from "react";

import { Checkbox, FormField, Input, Select } from "@/components/ui";
import { controlClasses } from "@/components/ui/control-classes";
import type { FieldSpec, RawValue } from "@/lib/abm/fields";
import type { LinkOption } from "@/lib/abm/types";
import { cn } from "@/lib/cn";

interface FieldInputProps {
  spec: FieldSpec;
  value: RawValue | undefined;
  onChange: (value: RawValue) => void;
  error?: string;
  /** link: opciones elegibles */
  options?: LinkOption[];
  /** link: etiquetas de todos los registros (para mostrar valores que ya no son elegibles) */
  labels?: Record<string, string>;
  disabled?: boolean;
  /** readonly: texto ya formateado */
  display?: string;
}

const NUMERIC = new Set(["number", "integer", "percent"]);

/** Un control de formulario según el tipo de campo del spec. */
export function FieldInput({ spec, value, onChange, error, options = [], labels = {}, disabled, display }: FieldInputProps) {
  if (spec.kind === "checkbox") {
    return (
      <div className="flex flex-col gap-1.5">
        <Checkbox label={spec.label} checked={value === true} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }

  const text = typeof value === "string" ? value : "";
  const selected = Array.isArray(value) ? value : [];
  // Valores guardados que ya no están entre las opciones (p. ej. un proyecto cerrado) se muestran igual.
  const allOptions: LinkOption[] = [
    ...options,
    ...selected.filter((id) => !options.some((o) => o.id === id)).map((id) => ({ id, label: `${labels[id] ?? id} (no disponible)` })),
  ];

  return (
    <FormField label={spec.label} required={spec.required} error={error} hint={spec.hint}>
      {spec.kind === "readonly" ? (
        <p className="min-h-10 rounded-md border border-line bg-bg px-3 py-2 text-sm text-muted">{display || "—"}</p>
      ) : spec.kind === "multiline" ? (
        <MultilineInput value={text} onChange={onChange} disabled={disabled} invalid={Boolean(error)} />
      ) : spec.kind === "select" ? (
        <Select
          value={text}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={spec.required ? "Elegí una opción" : "—"}
          options={(spec.options ?? []).map((o) => ({ value: o, label: o }))}
        />
      ) : spec.kind === "link" && !spec.multiple ? (
        <Select
          value={selected[0] ?? ""}
          onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
          disabled={disabled}
          placeholder={spec.required ? "Elegí una opción" : "Sin asignar"}
          options={allOptions.map((o) => ({ value: o.id, label: o.label }))}
        />
      ) : spec.kind === "link" ? (
        <MultiPicker options={allOptions} selected={selected} onChange={onChange} disabled={disabled} />
      ) : (
        <Input
          type={spec.kind === "email" ? "email" : spec.kind === "phone" ? "tel" : "text"}
          inputMode={NUMERIC.has(spec.kind) ? "decimal" : spec.kind === "cuit" ? "numeric" : undefined}
          value={text}
          placeholder={spec.placeholder ?? (spec.kind === "date" ? "DD/MM/AAAA" : undefined)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={spec.uppercase ? "uppercase" : undefined}
        />
      )}
    </FormField>
  );
}

function MultilineInput({ value, onChange, disabled, invalid }: { value: string; onChange: (v: string) => void; disabled?: boolean; invalid: boolean }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      rows={3}
      aria-invalid={invalid || undefined}
      className={cn(controlClasses, "h-auto min-h-20 py-2")}
    />
  );
}

/** Multi-select de links como lista de checkboxes. */
function MultiPicker({
  options,
  selected,
  onChange,
  disabled,
}: {
  options: LinkOption[];
  selected: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const baseId = useId();
  if (options.length === 0) return <p className="text-sm text-muted">No hay opciones disponibles.</p>;
  return (
    <div className="max-h-52 overflow-y-auto rounded-md border border-line bg-surface p-2">
      <ul className="flex flex-col gap-1">
        {options.map((o) => (
          <li key={o.id}>
            <Checkbox
              id={`${baseId}-${o.id}`}
              label={o.label}
              checked={selected.includes(o.id)}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? [...selected, o.id] : selected.filter((id) => id !== o.id))}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
