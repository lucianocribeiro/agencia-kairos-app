/**
 * Estado de Clientes (Fase 2): Activo / Inactivo. Client-safe.
 *
 * Solo `Activo` cuenta como activo (pickers de Proyectos, Horas y asignaciones).
 * La compatibilidad con las opciones viejas se quitó en CC-F2-02, después de la
 * migración (`scripts/migrate-clientes-estado.mjs`).
 */

export const CLIENTE_ACTIVO = "Activo";
export const CLIENTE_INACTIVO = "Inactivo";
export const CLIENTE_ESTADOS = [CLIENTE_ACTIVO, CLIENTE_INACTIVO] as const;

/** ¿El cliente está Activo? */
export function isClienteActivo(value: unknown): boolean {
  return value === CLIENTE_ACTIVO;
}
