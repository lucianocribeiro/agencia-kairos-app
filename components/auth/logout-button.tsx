"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

import { LOGIN_PATH } from "@/lib/auth/constants";

/**
 * Cierra la sesión con fetch JSON (POST /api/auth/logout exige JSON; ningún
 * formulario HTML le postea) y después navega a /login.
 */
export function LogoutButton({ className, label = "Cerrar sesión", compact = false }: { className?: string; label?: string; compact?: boolean }) {
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "same-origin",
      });
    } finally {
      // Navegación completa (no router.push): descarta el estado y el caché del cliente de la
      // sesión cerrada, y replace saca la página logueada del historial.
      window.location.replace(LOGIN_PATH);
    }
  }

  return (
    <button type="button" onClick={logout} disabled={pending} aria-label={label} className={className}>
      <LogOut aria-hidden="true" className="size-4" />
      <span className={compact ? "hidden lg:inline" : undefined}>{label}</span>
    </button>
  );
}
