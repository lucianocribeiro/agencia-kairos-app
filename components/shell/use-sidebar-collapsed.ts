"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Estado colapsado del sidebar, persistido en localStorage.
 *
 * useSyncExternalStore usa `getServerSnapshot` (false = expandido) en el
 * servidor y durante la hidratación, y después aplica el valor guardado: no
 * hay hydration mismatch. Si localStorage no está disponible (modo privado,
 * bloqueado), funciona en memoria.
 */

const STORAGE_KEY = "kairos.sidebar.collapsed";
const DEFAULT_COLLAPSED = false;

const listeners = new Set<() => void>();
let memoryValue: boolean | null = null;

function readStored(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return raw === "1";
  } catch {
    // localStorage no disponible
  }
  return memoryValue ?? DEFAULT_COLLAPSED;
}

function writeStored(value: boolean): void {
  memoryValue = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // localStorage no disponible: queda en memoria
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSidebarCollapsed(): [boolean, (value: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribe, readStored, () => DEFAULT_COLLAPSED);
  const setCollapsed = useCallback((value: boolean) => writeStored(value), []);
  return [collapsed, setCollapsed];
}
