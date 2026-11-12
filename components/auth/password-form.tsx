"use client";

import { useState, type FormEvent } from "react";

import { Button, FormField, InlineMessage, Input } from "@/components/ui";
import { checkNewPassword, PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

import { useJsonPost } from "./use-json-post";


export function PasswordForm() {
  const { submit, pending, error } = useJsonPost("/api/auth/password");
  const [local, setLocal] = useState<{ field: string; message: string } | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const actual = String(data.get("actual") ?? "");
    const nueva = String(data.get("nueva") ?? "");
    const repetir = String(data.get("repetir") ?? "");

    // Mismas reglas que el servidor (que las vuelve a validar).
    const policy = checkNewPassword(nueva);
    if (policy) return setLocal({ field: "nueva", message: policy });
    if (nueva !== repetir) return setLocal({ field: "repetir", message: "Las contraseñas nuevas no coinciden." });
    if (nueva === actual) return setLocal({ field: "nueva", message: "Tiene que ser distinta de la actual." });
    setLocal(null);
    void submit({ actual, nueva, repetir });
  }

  const fieldError = (name: string) =>
    local?.field === name ? local.message : error?.field === name ? error.message : undefined;
  const generalError = error && !error.field ? error.message : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {generalError && <InlineMessage tone="danger">{generalError}</InlineMessage>}
      <FormField label="Contraseña actual" required error={fieldError("actual")}>
        <Input type="password" name="actual" autoComplete="current-password" autoFocus />
      </FormField>
      <FormField label="Contraseña nueva" required hint={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres, máximo ${PASSWORD_MAX_BYTES} bytes.`} error={fieldError("nueva")}>
        <Input type="password" name="nueva" autoComplete="new-password" />
      </FormField>
      <FormField label="Repetí la contraseña nueva" required error={fieldError("repetir")}>
        <Input type="password" name="repetir" autoComplete="new-password" />
      </FormField>
      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? "Guardando…" : "Cambiar contraseña"}
      </Button>
    </form>
  );
}
