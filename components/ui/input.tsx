"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";
import { controlClasses } from "./control-classes";
import { useFormField } from "./form-field";

export function Input({ className, id, ...props }: ComponentProps<"input">) {
  const field = useFormField();
  return (
    <input
      id={id ?? field?.id}
      aria-invalid={props["aria-invalid"] ?? (field?.invalid || undefined)}
      aria-describedby={props["aria-describedby"] ?? field?.describedBy}
      required={props.required ?? field?.required}
      className={cn(controlClasses, className)}
      {...props}
    />
  );
}
