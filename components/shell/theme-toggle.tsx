"use client";

import { Moon, Sun } from "lucide-react";
import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";
import {
  applyTheme,
  DEFAULT_THEME,
  readStoredTheme,
  THEME_STORAGE_KEY,
  THEME_TOGGLE_LABEL,
  themeOf,
  writeStoredTheme,
  type Theme,
} from "@/lib/theme";

/**
 * Estado del tema = la clase de <html> (la pone el script inline antes de pintar).
 * useSyncExternalStore usa DEFAULT_THEME en el servidor y en la hidratación, y
 * después lee la clase real: no hay hydration mismatch.
 */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Otra pestaña cambió el tema.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyTheme(document.documentElement, readStoredTheme() ?? DEFAULT_THEME);
    notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = (): Theme => themeOf(document.documentElement);
const getServerSnapshot = (): Theme => DEFAULT_THEME;

export function setTheme(theme: Theme): void {
  applyTheme(document.documentElement, theme);
  writeStoredTheme(theme);
  notify();
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [theme, useCallback((t: Theme) => setTheme(t), [])];
}

/**
 * Re-aplica lo guardado antes de pintar. En producción no cambia nada (el script ya lo
 * puso); en desarrollo, el remount de Strict Mode le resetea los atributos a <html>.
 * Va en el root layout, así cubre también las páginas sin toggle.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    const stored = readStoredTheme();
    if (stored && stored !== themeOf(document.documentElement)) {
      applyTheme(document.documentElement, stored);
      notify();
    }
  }, []);
  return null;
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, set] = useTheme();
  const label = THEME_TOGGLE_LABEL[theme];
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => set(theme === "dark" ? "light" : "dark")}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-card hover:text-text",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
