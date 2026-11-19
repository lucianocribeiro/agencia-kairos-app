"use client";

import type { FormEvent } from "react";

import { Button, Checkbox, FormField, InlineMessage, Input } from "@/components/ui";
import { useHydrated } from "@/components/ui/use-hydrated";
import { NO_JS_MESSAGE, noJsAction } from "@/lib/no-js-form";
import { useJsonPost } from "./use-json-post";

export function LoginForm() {
  const { submit, pending, error } = useJsonPost("/api/auth/login");
  const hydrated = useHydrated();

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
    // POST y action segura: un envío nativo (antes de hidratar) nunca pone la contraseña en la URL (CC-F4-10).
    <form method="post" action={noJsAction("login")} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <noscript>
        <InlineMessage tone="info">{NO_JS_MESSAGE}</InlineMessage>
      </noscript>
      {error && <InlineMessage tone="danger">{error.message}</InlineMessage>}
      <FormField label="Email" required>
        <Input type="email" name="email" autoComplete="username" inputMode="email" autoFocus />
      </FormField>
      <FormField label="Contraseña" required>
        <Input type="password" name="password" autoComplete="current-password" />
      </FormField>
      <Checkbox name="robot" label="No soy un robot" />
      <Button type="submit" disabled={!hydrated || pending} className="mt-2 w-full">
        {pending ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
