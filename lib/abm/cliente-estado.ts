/**
 * Estado de Clientes (Fase 2): Activo / Inactivo. Client-safe.
 *
 * COMPATIBILIDAD TEMPORAL: hasta que corra `npm run migrate:clientes-estado -- --apply`,
 * los clientes reales tienen la opción vieja «Cliente». La app la trata como Activo en
 * todos lados (pickers, filtro, lista, formulario) y al guardar un registro editado se
 * escribe «Activo». Lead / Ex cliente / Perdido NO cuentan como Activo.
 * Después de la migración se borran LEGACY_CLIENTE_ACTIVO, LEGACY_CLIENTE_ESTADOS y la
 * rama legacy de normalizeClienteEstado (un solo cambio en este archivo).
 * Los literales viejos solo pueden aparecer acá, en scripts/lib/migrate-clientes-estado.mjs
 * y en tests que los importen de esos módulos (test/legacy-literals.test.ts).
 */

export const CLIENTE_ACTIVO = "Activo";
export const CLIENTE_INACTIVO = "Inactivo";
export const CLIENTE_ESTADOS = [CLIENTE_ACTIVO, CLIENTE_INACTIVO] as const;

/** LEGACY: opción vieja que equivale a Activo. Borrar después de la migración. */
export const LEGACY_CLIENTE_ACTIVO = "Cliente";
/** LEGACY: todas las opciones viejas (para tests y avisos). Borrar después de la migración. */
export const LEGACY_CLIENTE_ESTADOS = [LEGACY_CLIENTE_ACTIVO, "Lead", "Ex cliente", "Perdido"] as const;

/** Estado guardado → Estado que ve y usa la app («Cliente» → «Activo»; el resto, tal cual). */
export function normalizeClienteEstado(value: unknown): string | null {
  if (value === LEGACY_CLIENTE_ACTIVO) return CLIENTE_ACTIVO;
  return typeof value === "string" && value !== "" ? value : null;
}

/** ¿El cliente cuenta como Activo (incluye el legacy «Cliente»)? */
export function isClienteActivo(value: unknown): boolean {
  return normalizeClienteEstado(value) === CLIENTE_ACTIVO;
}
