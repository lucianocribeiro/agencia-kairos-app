"use client";

import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { useFormField } from "./form-field";

export interface CheckboxProps extends Omit<ComponentProps<"input">, "type"> {
  /** Texto al lado del checkbox. Si se usa dentro de FormField, se puede omitir. */
  label?: ReactNode;
}

export function Checkbox({ label, className, id, ...props }: CheckboxProps) {
  const field = useFormField();
  const autoId = useId();
  const inputId = id ?? field?.id ?? autoId;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <input
        type="checkbox"
        id={inputId}
        aria-invalid={props["aria-invalid"] ?? (field?.invalid || undefined)}
        aria-describedby={props["aria-describedby"] ?? field?.describedBy}
        className="size-4 cursor-pointer rounded border-line bg-surface disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      />
      {label && (
        <label htmlFor={inputId} className="cursor-pointer text-sm text-text select-none">
          {label}
        </label>
      )}
    </div>
  );
}
