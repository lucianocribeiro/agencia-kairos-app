"use client";

import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";
import { controlClasses } from "./control-classes";
import { useFormField } from "./form-field";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends ComponentProps<"select"> {
  options?: readonly SelectOption[];
  /** Texto de la opción vacía inicial, p. ej. "Elegí una opción". */
  placeholder?: string;
}

export function Select({ className, id, options, placeholder, children, ...props }: SelectProps) {
  const field = useFormField();
  return (
    <div className="relative">
      <select
        id={id ?? field?.id}
        aria-invalid={props["aria-invalid"] ?? (field?.invalid || undefined)}
        aria-describedby={props["aria-describedby"] ?? field?.describedBy}
        required={props.required ?? field?.required}
        className={cn(controlClasses, "appearance-none pr-9", className)}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
