"use client";

// Fixture POSITIVA: solo password-policy, tipos de servidor (borrados) y paquetes.
import type { SessionUser } from "@/lib/auth/session";
import { type AuthUser } from "@/lib/auth/credentials";
import { checkNewPassword } from "@/lib/auth/password-policy";
import { useState } from "react";

export function Ok({ user }: { user: SessionUser | AuthUser }) {
  const [v] = useState("");
  return <p>{user.nombre + (checkNewPassword(v) ?? "")}</p>;
}
