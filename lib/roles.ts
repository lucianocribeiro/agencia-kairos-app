/** Roles de la app. Coinciden con las opciones de Usuarios.rol en Airtable. */
export const ROLES = ["Admin", "Empleado", "Cliente"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Rol Cliente (constante para no confundirlo con la vieja opción «Cliente» de Clientes › Estado). */
export const ROL_CLIENTE = "Cliente" satisfies Role;

/** Vista del rol Cliente (horas e importes de sus proyectos). */
export const CLIENTE_HOME = "/cliente/horas";

/** Inicio de cada rol. Client-safe: lo usan el menú y lib/auth/constants. */
export const HOME_BY_ROLE: Record<Role, string> = {
  Admin: "/dashboard",
  Empleado: "/mis-horas",
  Cliente: CLIENTE_HOME,
};
