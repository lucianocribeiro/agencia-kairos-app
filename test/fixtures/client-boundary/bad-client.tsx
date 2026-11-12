"use client";

// Fixture NEGATIVA (solo para test/client-boundary.test.ts): llega a lib/env.ts por un
// módulo intermedio y a lib/auth/constants.ts directo.
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { checkNewPassword } from "@/lib/auth/password-policy";

import { leak } from "./helper";

export function Bad() {
  return <p>{`${SESSION_COOKIE}${leak()}${checkNewPassword("x") ?? ""}`}</p>;
}
