/**
 * Spec y validación del ABM de Usuarios. Client-safe: lo usan el formulario y
 * lib/abm/server/usuarios-service.ts (fuente de verdad).
 */
import { checkNewPassword } from "@/lib/auth/password-policy";
import { parseValues, type FieldErrors, type FieldSpec, type Mode, type RawValues, type Values } from "./fields";

export const USUARIO_FIELDS: readonly FieldSpec[] = [
  { key: "nombre", label: "Nombre", kind: "text", required: true },
  { key: "email", label: "Email", kind: "email", required: true, lowercase: true },
  { key: "rol", label: "Rol", kind: "select", required: true, options: ["Admin", "Empleado"] },
  {
    key: "sigla",
    label: "Sigla",
    kind: "text",
    required: true,
    uppercase: true,
    pattern: { regex: /^[A-Z]{2,4}$/, message: "La sigla tiene que tener entre 2 y 4 letras." },
  },
  { key: "socio", label: "Socio", kind: "link" },
  { key: "proyectosAsignados", label: "Proyectos asignados", kind: "link", multiple: true, hint: "Solo proyectos activos." },
];

export const USUARIO_MESSAGES = {
  passwordRequerida: "Ingresá o generá una contraseña temporal.",
  emailDuplicado: "Ya existe un usuario con ese email.",
  siglaDuplicada: "Ya existe un usuario con esa sigla.",
  propioRol: "No podés cambiar tu propio rol.",
  propioDesactivar: "No podés desactivar tu propio usuario.",
  propiaPassword: "Para tu propia contraseña usá «Cambiar contraseña».",
  ultimoAdmin: "Tiene que quedar al menos un Admin activo.",
} as const;

/**
 * Valida el formulario de usuario. Los proyectos asignados solo cuentan para
 * Empleados: si el rol es Admin se descartan (al editar, no se tocan).
 * La contraseña temporal solo se pide al crear.
 */
export function validateUsuario(raw: RawValues, mode: Mode): { values: Values; errors: FieldErrors; password?: string } {
  const { values, errors } = parseValues(USUARIO_FIELDS, raw, mode);
  if (values.rol !== "Empleado") delete values.proyectosAsignados;
  let password: string | undefined;
  if (mode === "create") {
    password = typeof raw.password === "string" ? raw.password : "";
    const problem = password ? checkNewPassword(password) : USUARIO_MESSAGES.passwordRequerida;
    if (problem) errors.password = problem;
  }
  return { values, errors, password };
}

/** Valida una contraseña temporal (reset). */
export function validateTemporaryPassword(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return USUARIO_MESSAGES.passwordRequerida;
  return checkNewPassword(raw);
}

/** Claves que acepta la API de Usuarios: las del spec, y la contraseña temporal solo en el alta. */
export const USUARIO_INPUT_KEYS = {
  create: [...USUARIO_FIELDS.map((f) => f.key), "password"],
  edit: USUARIO_FIELDS.map((f) => f.key),
} as const;
