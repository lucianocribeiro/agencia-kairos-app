/** Roles de la app. Coinciden con las opciones de Usuarios.rol en Airtable. */
export const ROLES = ["Admin", "Empleado"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
