/**
 * Modo claro / oscuro (CC-F4-09). Client-safe, sin acceso al DOM al importar.
 *
 * - Oscuro es el default: sin nada guardado (o si localStorage falla) no hay clase.
 * - Claro = clase `light` en <html>; los tokens claros están en `html.light` (app/globals.css).
 * - Se guarda por navegador en localStorage (como el sidebar), nunca en el servidor.
 * - `THEME_INIT_SCRIPT` corre inline en el <head> del root layout, antes de pintar.
 */

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "kairos.theme";
export const DEFAULT_THEME: Theme = "dark";
export const LIGHT_CLASS = "light";

export const THEME_TOGGLE_LABEL: Record<Theme, string> = {
  dark: "Cambiar a modo claro",
  light: "Cambiar a modo oscuro",
};

/** Cualquier valor que no sea exactamente "light" → oscuro. */
export function parseTheme(raw: unknown): Theme {
  return raw === "light" ? "light" : DEFAULT_THEME;
}

/** Lee lo guardado; si localStorage no está disponible o tira, `null`. */
export function readStoredTheme(storage: () => Storage | undefined = () => globalThis.localStorage): Theme | null {
  try {
    const raw = storage()?.getItem(THEME_STORAGE_KEY);
    return raw == null ? null : parseTheme(raw);
  } catch {
    return null;
  }
}

/** Guarda el tema; devuelve false si no se pudo (queda solo en la clase de <html>). */
export function writeStoredTheme(theme: Theme, storage: () => Storage | undefined = () => globalThis.localStorage): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

export function themeOf(root: Element): Theme {
  return root.classList.contains(LIGHT_CLASS) ? "light" : "dark";
}

export function applyTheme(root: Element, theme: Theme): void {
  root.classList.toggle(LIGHT_CLASS, theme === "light");
}

/** Script inline del <head>: misma regla que `readStoredTheme` + `applyTheme`, sin dependencias. */
export const THEME_INIT_SCRIPT =
  `(function(){try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==="light")` +
  `document.documentElement.classList.add(${JSON.stringify(LIGHT_CLASS)})}catch(e){}})()`;
