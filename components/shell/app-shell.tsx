"use client";

import { KeyRound, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { cn } from "@/lib/cn";
import type { Role } from "@/lib/roles";
import { Logo } from "./logo";
import { SidebarNav } from "./sidebar-nav";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";

const iconButton =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-card hover:text-text";

/**
 * Shell de la app: sidebar a la izquierda + contenido.
 *
 * - md+: sidebar fijo, colapsable (íconos solos) con el botón hamburguesa.
 *   El estado se guarda en localStorage.
 * - Header: nombre del usuario, "Cambiar contraseña" y "Cerrar sesión".
 * - < md: hamburguesa en el header; el menú es un drawer con backdrop
 *   que se cierra al navegar, con Escape o tocando el fondo.
 */
export interface ShellUser {
  nombre: string;
  rol: Role;
}

const headerAction =
  "inline-flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-muted transition-colors hover:bg-card hover:text-text";

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const role = user.rol;
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Cerrar el drawer en cualquier navegación (links, atrás/adelante).
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    openButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobile();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen, closeMobile]);

  return (
    <div className="flex min-h-dvh">
      {/* Desktop */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 border-r border-line bg-surface transition-[width] duration-200 md:block",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <SidebarNav
          role={role}
          pathname={pathname}
          collapsed={collapsed}
          navId="sidebar-nav"
          onExpand={() => setCollapsed(false)}
          headerAction={
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
              aria-expanded={!collapsed}
              aria-controls="sidebar-nav"
              title={collapsed ? "Expandir menú" : "Contraer menú"}
              className={iconButton}
            >
              <Menu aria-hidden="true" className="size-5" />
            </button>
          }
        />
      </aside>

      {/* Mobile: drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div aria-hidden="true" className="absolute inset-0 bg-black/70" onClick={closeMobile} />
          <aside
            id="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menú"
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface shadow-xl shadow-black"
          >
            <SidebarNav
              role={role}
              pathname={pathname}
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
              headerAction={
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={closeMobile}
                  aria-label="Cerrar menú"
                  className={iconButton}
                >
                  <X aria-hidden="true" className="size-5" />
                </button>
              }
            />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 md:px-8">
          <button
            ref={openButtonRef}
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
            aria-expanded={mobileOpen}
            aria-controls="mobile-drawer"
            className={cn(iconButton, "md:hidden")}
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>
          <Logo className="h-8 md:hidden" eager />

          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
            <span className="hidden max-w-56 truncate text-sm font-medium text-text sm:inline">{user.nombre}</span>
            <Link href="/cambiar-password" aria-label="Cambiar contraseña" className={headerAction}>
              <KeyRound aria-hidden="true" className="size-4" />
              <span className="hidden lg:inline">Cambiar contraseña</span>
            </Link>
            <LogoutButton compact className={headerAction} />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
