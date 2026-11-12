"use client";

import { createContext, useContext, useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Lo usan Input, Select y Checkbox para conectarse solos con su FormField. */
export function useFormField(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FormFieldProps {
  label: ReactNode;
  children: ReactNode;
  /** Mensaje de error de validación. Si está, el control queda aria-invalid. */
  error?: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  id?: string;
  className?: string;
}

/**
 * Label + control + ayuda + error, con ids y aria conectados.
 *
 *   <FormField label="Email" error={errors.email} required>
 *     <Input type="email" name="email" />
 *   </FormField>
 */
export function FormField({ label, children, error, hint, required = false, id, className }: FormFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id: fieldId, describedBy, invalid: Boolean(error), required }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={fieldId} className="text-sm font-medium text-text">
          {label}
          {required && (
            <span className="ml-0.5 text-muted" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {children}
        {hint && (
          <p id={hintId} className="text-xs text-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
