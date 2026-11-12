"use client";

import type { FormEvent } from "react";

import { Button, Checkbox, FormField, InlineMessage, Input } from "@/components/ui";
import { useJsonPost } from "./use-json-post";

export function LoginForm() {
  const { submit, pending, error } = useJsonPost("/api/auth/login");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void submit({
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
      robot: data.get("robot") === "on",
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {error && <InlineMessage tone="danger">{error.message}</InlineMessage>}
      <FormField label="Email" required>
        <Input type="email" name="email" autoComplete="username" inputMode="email" autoFocus />
      </FormField>
      <FormField label="Contraseña" required>
        <Input type="password" name="password" autoComplete="current-password" />
      </FormField>
      <Checkbox name="robot" label="No soy un robot" />
      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
