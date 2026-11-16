/**
 * Spec y validación del ABM de Usuarios. Client-safe: lo usan el formulario y
 * lib/abm/server/usuarios-service.ts (fuente de verdad).
 */
import { checkNewPassword } from "@/lib/auth/password-policy";
import { parseValues, type FieldErrors, type FieldSpec, type Mode, type RawValues, type Values } from "./fields";

export const USUARIO_FIELDS: readonly FieldSpec[] = [
  { key: "nombre", label: "Nombre", kind: "text", required: true },
  { key: "email", label: "Email", kind: "email", required: true, lowercase: true },
  { key: "rol", label: "Rol", kind: "select", required: true, options: ["Admin", "Empleado", "Cliente"] },
  {
    key: "sigla",
    label: "Sigla",
    kind: "text",
    required: true,
    uppercase: true,
    pattern: { regex: /^[A-Z]{2,4}$/, message: "La sigla tiene que tener entre 2 y 4 letras." },
  },
  { key: "socio", label: "Socio", kind: "link" },
  { key: "proyectosAsignados", label: "Proyectos asignados", kind: "link", multiple: true, hint: "Solo proyectos activos de clientes activos." },
];

/** Roles con Proyectos asignados (Empleado: dónde carga horas; Cliente: qué ve). */
export const rolConProyectos = (rol: unknown) => rol === "Empleado" || rol === "Cliente";

const HINT_PROYECTOS_CLIENTE = "Solo proyectos activos de clientes activos, con valor hora y moneda, todos del mismo cliente.";

/**
 * Campos del formulario según el rol. Cliente: Sigla opcional, sin Socio, y Proyectos
 * asignados obligatorios. El resto, como siempre.
 */
export function usuarioFieldsFor(rol: unknown): readonly FieldSpec[] {
  if (rol !== "Cliente") return USUARIO_FIELDS;
  return USUARIO_FIELDS.filter((f) => f.key !== "socio").map((f) =>
    f.key === "sigla" ? { ...f, required: false } : f.key === "proyectosAsignados" ? { ...f, required: true, hint: HINT_PROYECTOS_CLIENTE } : f,
  );
}

export const USUARIO_MESSAGES = {
  passwordRequerida: "Ingresá o generá una contraseña temporal.",
  emailDuplicado: "Ya existe un usuario con ese email.",
  siglaDuplicada: "Ya existe un usuario con esa sigla.",
  propioRol: "No podés cambiar tu propio rol.",
  propioDesactivar: "No podés desactivar tu propio usuario.",
  propiaPassword: "Para tu propia contraseña usá «Cambiar contraseña».",
  ultimoAdmin: "Tiene que quedar al menos un Admin activo.",
  clienteSinProyectos: "Un usuario Cliente tiene que tener al menos un proyecto asignado.",
  clienteSocio: "Un usuario Cliente no puede tener socio.",
  clienteMismoCliente: "Todos los proyectos de un usuario Cliente tienen que ser del mismo cliente.",
  clienteSinValorHora: "El proyecto tiene que tener valor hora y moneda para asignarlo a un usuario Cliente.",
} as const;

/**
 * Valida el formulario de usuario. Los proyectos asignados solo cuentan para
 * Empleados y Clientes: si el rol es Admin se descartan (al editar, no se tocan).
 * Cliente: al menos un proyecto, Socio vacío y Sigla opcional (las reglas de los
 * proyectos que necesitan la base las valida el servidor). La contraseña temporal
 * solo se pide al crear.
 */
export function validateUsuario(raw: RawValues, mode: Mode): { values: Values; errors: FieldErrors; password?: string } {
  const cliente = raw.rol === "Cliente";
  const { values, errors } = parseValues(cliente ? USUARIO_FIELDS.map((f) => (f.key === "sigla" ? { ...f, required: false } : f)) : USUARIO_FIELDS, raw, mode);
  if (!rolConProyectos(values.rol)) delete values.proyectosAsignados;
  if (cliente) {
    if (!errors.proyectosAsignados && !(Array.isArray(values.proyectosAsignados) && values.proyectosAsignados.length > 0)) {
      errors.proyectosAsignados = USUARIO_MESSAGES.clienteSinProyectos;
    }
    if (Array.isArray(values.socio) && values.socio.length > 0) errors.socio = USUARIO_MESSAGES.clienteSocio;
  }
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
