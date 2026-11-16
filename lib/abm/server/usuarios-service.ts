import "server-only";

import { getAirtableClient, type Fields } from "@/lib/airtable/client";
import { isUnique, losesUniqueRace } from "@/lib/airtable/integrity";
import { TABLES } from "@/lib/airtable/schema";
import { isClienteActivo } from "@/lib/abm/cliente-estado";
import { FIELD_MESSAGES, type FieldErrors, type RawValues, type Values } from "@/lib/abm/fields";
import type { AbmData, LinkOption, RecordDTO, ServiceResult } from "@/lib/abm/types";
import { USUARIO_MESSAGES, validateTemporaryPassword, validateUsuario } from "@/lib/abm/usuarios";
import { WrittenRecordMissingError } from "@/lib/airtable/integrity";
import { createUserWithTemporaryPassword, setTemporaryPassword } from "@/lib/auth/credentials";
import { invalidateCachedUser } from "@/lib/auth/user-cache";
import { Compensation, previousOf, runPostWriteChecks, type CheckConflict, type PostWriteCheck } from "./compensation";
import { ABM_MESSAGES } from "./maestros-service";

/**
 * ABM de Usuarios (Admin). Nunca lee ni devuelve el hash: las escrituras de
 * contraseña pasan por lib/auth/credentials.ts (hashNewPassword).
 *
 * Reglas de seguridad (servidor):
 * - un Admin no puede desactivarse ni cambiarse el rol a sí mismo
 * - no se puede desactivar ni pasar a Empleado al último Admin activo (409)
 * - toda escritura invalida el caché de sesión de ese usuario en esta instancia
 *
 * No hay transacciones: después de escribir se vuelve a verificar (último Admin
 * activo, email y sigla únicos) con runPostWriteChecks (el mismo de Maestros,
 * fail-closed): si otro request ganó la carrera → se deshace y 409; si la
 * verificación no se puede leer → se deshace y 503. Ver AGENTS.md, "Concurrencia".
 *
 * Rol Cliente: al menos un proyecto asignado; los nuevos, Activos de clientes Activos y
 * con valor hora y moneda; todos (nuevos y conservados) con valor hora y moneda y del
 * mismo Cliente; sin Socio. Se valida antes de escribir y se vuelve a verificar después
 * (`clienteProyectos`, fail-closed), también al activar un usuario Cliente. Un usuario
 * con Horas (Colaborador o Cargado por) no puede pasar a Cliente (`clienteSinHoras`).
 */

const U = TABLES.usuarios.fields;
const S = TABLES.socios.fields;
const P = TABLES.proyectos.fields;

/** Campos que se leen de Usuarios. Sin passwordHash. */
const LIST_FIELDS = [U.nombre, U.email, U.rol, U.estado, U.sigla, U.ultimoAcceso, U.socio, U.proyectosAsignados, U.debeCambiarPassword];

const KEY_TO_FIELD = {
  nombre: U.nombre,
  email: U.email,
  rol: U.rol,
  sigla: U.sigla,
  socio: U.socio,
  proyectosAsignados: U.proyectosAsignados,
} as const;

export interface Actor {
  id: string;
}

const fail = (status: 400 | 404 | 409, error: string, fieldErrors?: FieldErrors): ServiceResult<never> => ({
  ok: false,
  status,
  error,
  ...(fieldErrors ? { fieldErrors } : {}),
});

const isRecordId = (id: string) => /^rec[A-Za-z0-9]{14}$/.test(id);

function toDTO(id: string, f: Fields): RecordDTO {
  return {
    id,
    values: {
      nombre: (f[U.nombre] as string) ?? "",
      email: (f[U.email] as string) ?? "",
      rol: (f[U.rol] as string) ?? null,
      estado: (f[U.estado] as string) ?? null,
      sigla: (f[U.sigla] as string) ?? "",
      ultimoAcceso: (f[U.ultimoAcceso] as string) ?? null,
      socio: (f[U.socio] as string[]) ?? [],
      proyectosAsignados: (f[U.proyectosAsignados] as string[]) ?? [],
      debeCambiarPassword: f[U.debeCambiarPassword] === true,
    },
  };
}

async function loadOptions(): Promise<Pick<AbmData, "labels" | "options">> {
  const client = getAirtableClient();
  const [socios, proyectos, clientes] = await Promise.all([
    client.list(TABLES.socios.id, { fields: [S.sigla, S.nombre] }),
    client.list(TABLES.proyectos.id, { fields: PROYECTO_FIELDS }),
    client.list(TABLES.clientes.id, { fields: [TABLES.clientes.fields.estado] }),
  ]);
  const clientesActivos = new Set(clientes.filter((r) => isClienteActivo(r.fields[TABLES.clientes.fields.estado])).map((r) => r.id));
  /** Asignable: proyecto Activo y su Cliente Activo. */
  const asignable = (f: Fields) => {
    const cliente = (f[P.cliente] as string[] | undefined)?.[0];
    return f[P.estado] === "Activo" && !!cliente && clientesActivos.has(cliente);
  };
  const socioLabel = (f: Fields) => [f[S.sigla], f[S.nombre]].filter(Boolean).join(" · ") || "(sin nombre)";
  const proyectoLabel = (f: Fields) => (f[P.codigo] as string) || "(sin código)";
  const sort = (a: LinkOption, b: LinkOption) => a.label.localeCompare(b.label, "es");
  return {
    labels: {
      socio: Object.fromEntries(socios.map((r) => [r.id, socioLabel(r.fields)])),
      proyectosAsignados: Object.fromEntries(proyectos.map((r) => [r.id, proyectoLabel(r.fields)])),
    },
    options: {
      socio: socios.map((r) => ({ id: r.id, label: socioLabel(r.fields) })).sort(sort),
      // Solo proyectos Activos de clientes Activos. checkLinksAndUnique valida el guardado con
      // estas mismas opciones (más lo que el usuario ya tenía asignado, que se conserva).
      proyectosAsignados: proyectos
        .filter((r) => asignable(r.fields))
        .map((r) => ({ id: r.id, label: proyectoLabel(r.fields) }))
        .sort(sort),
      // Rol Cliente: además, con valor hora y moneda (la regla «mismo cliente» la valida el guardado).
      proyectosCliente: proyectos
        .filter((r) => asignable(r.fields) && conValorHora(r.fields))
        .map((r) => ({ id: r.id, label: proyectoLabel(r.fields) }))
        .sort(sort),
    },
  };
}

const PROYECTO_FIELDS = [P.codigo, P.estado, P.cliente, P.valorHora, P.monedaValorHora];

/** Valor hora (número) y moneda (ARS/USD) cargados. */
const conValorHora = (f: Fields) =>
  typeof f[P.valorHora] === "number" && Number.isFinite(f[P.valorHora]) && (f[P.monedaValorHora] === "ARS" || f[P.monedaValorHora] === "USD");

/**
 * Reglas de los proyectos de un usuario Cliente que dependen de la base: cada proyecto
 * existe y tiene valor hora y moneda, y todos son del mismo Cliente. null = OK.
 */
function problemaProyectosCliente(ids: readonly string[], proyectos: ReadonlyMap<string, Fields>): string | null {
  if (ids.length === 0) return USUARIO_MESSAGES.clienteSinProyectos;
  if (ids.some((id) => !proyectos.has(id))) return FIELD_MESSAGES.link;
  if (ids.some((id) => !conValorHora(proyectos.get(id)!))) return USUARIO_MESSAGES.clienteSinValorHora;
  const clientes = new Set(ids.map((id) => (proyectos.get(id)![P.cliente] as string[] | undefined)?.[0] ?? null));
  if (clientes.size !== 1 || clientes.has(null)) return USUARIO_MESSAGES.clienteMismoCliente;
  return null;
}

async function proyectosPorId(): Promise<Map<string, Fields>> {
  const rows = await getAirtableClient().list(TABLES.proyectos.id, { fields: PROYECTO_FIELDS });
  return new Map(rows.map((r) => [r.id, r.fields]));
}

/**
 * Verificación posterior (carreras) para un usuario que quedó con Rol Cliente: relee el
 * usuario y sus proyectos. Un proyecto que perdió valor hora o moneda, o que cambió de
 * cliente, mientras se escribía → conflicto (se deshace, 409). Si la relectura no trae
 * al usuario → WrittenRecordMissingError (deshacer → 503).
 */
const clienteProyectosCheck = (id: string): PostWriteCheck => ({
  name: "clienteProyectos",
  run: async () => {
    const [user, proyectos] = await Promise.all([
      getAirtableClient().get(TABLES.usuarios.id, id, { fields: [U.rol, U.proyectosAsignados] }),
      proyectosPorId(),
    ]);
    if (!user) throw new WrittenRecordMissingError(id);
    if (user.fields[U.rol] !== "Cliente") return null;
    const problema = problemaProyectosCliente((user.fields[U.proyectosAsignados] as string[] | undefined) ?? [], proyectos);
    return problema ? { error: ABM_MESSAGES.validacion, fieldErrors: { proyectosAsignados: problema } } : null;
  },
});

export async function loadUsuarios(): Promise<AbmData> {
  const [records, linkData] = await Promise.all([
    getAirtableClient().list(TABLES.usuarios.id, { fields: LIST_FIELDS, sort: [{ field: U.nombre }] }),
    loadOptions(),
  ]);
  return { records: records.map((r) => toDTO(r.id, r.fields)), ...linkData };
}

async function getUsuario(id: string): Promise<Fields | null> {
  const record = await getAirtableClient().get(TABLES.usuarios.id, id, { fields: LIST_FIELDS });
  return record?.fields ?? null;
}

async function activeAdminIds(): Promise<string[]> {
  const rows = await getAirtableClient().list(TABLES.usuarios.id, { fields: [U.rol, U.estado] });
  return rows.filter((r) => r.fields[U.rol] === "Admin" && r.fields[U.estado] === "Activo").map((r) => r.id);
}

/** ¿Este cambio deja la base sin Admins activos? */
async function wouldRemoveLastAdmin(id: string, existing: Fields): Promise<boolean> {
  if (existing[U.rol] !== "Admin" || existing[U.estado] !== "Activo") return false;
  const admins = await activeAdminIds();
  return admins.filter((a) => a !== id).length === 0;
}

async function checkLinksAndUnique(values: Values, excludeId?: string, existing?: Fields): Promise<{ status: 400 | 409; errors: FieldErrors } | null> {
  const { options } = await loadOptions();
  const errors: FieldErrors = {};
  const cliente = values.rol === "Cliente";
  for (const key of ["socio", "proyectosAsignados"] as const) {
    const ids = values[key];
    if (!Array.isArray(ids) || ids.length === 0) continue;
    // Cliente: solo los proyectos del selector de Cliente (lo ya asignado se puede conservar).
    const source = key === "proyectosAsignados" && cliente ? options.proyectosCliente : options[key];
    // Al cambiar de rol se aplican las reglas del rol nuevo: un Cliente solo conserva lo que ya tenía como Cliente.
    const kept = key === "proyectosAsignados" && cliente && existing?.[U.rol] !== "Cliente" ? [] : ((existing?.[KEY_TO_FIELD[key]] as string[] | undefined) ?? []);
    const allowed = new Set([...source.map((o) => o.id), ...kept]);
    if (ids.some((id) => !allowed.has(id))) errors[key] = key === "proyectosAsignados" && cliente ? await motivoNoAsignable(ids, allowed) : FIELD_MESSAGES.link;
  }
  if (cliente && !errors.proyectosAsignados) {
    const problema = problemaProyectosCliente((values.proyectosAsignados as string[] | undefined) ?? [], await proyectosPorId());
    if (problema) errors.proyectosAsignados = problema;
  }
  if (Object.keys(errors).length > 0) return { status: 400, errors };

  if (!(await isUnique(TABLES.usuarios.id, U.email, values.email, { excludeId }))) errors.email = USUARIO_MESSAGES.emailDuplicado;
  if (!(await isUnique(TABLES.usuarios.id, U.sigla, values.sigla, { excludeId }))) errors.sigla = USUARIO_MESSAGES.siglaDuplicada;
  return Object.keys(errors).length > 0 ? { status: 409, errors } : null;
}

/**
 * ¿El usuario está en algún registro de Horas (como Colaborador o como Cargado por)?
 * Se lee de los links inversos del propio usuario (los mantiene Airtable). Si el usuario
 * no aparece → WrittenRecordMissingError (en la verificación posterior: deshacer → 503).
 */
async function tieneHoras(id: string): Promise<boolean> {
  const user = await getAirtableClient().get(TABLES.usuarios.id, id, { fields: [U.horasReverse, U.horas2Reverse] });
  if (!user) throw new WrittenRecordMissingError(id);
  return [U.horasReverse, U.horas2Reverse].some((f) => ((user.fields[f] as unknown[] | undefined) ?? []).length > 0);
}

const conHorasConflict: CheckConflict = { error: USUARIO_MESSAGES.clienteConHoras, fieldErrors: { rol: USUARIO_MESSAGES.clienteConHoras } };

/** Verificación posterior del cambio a Cliente: si en el medio se cargó una hora suya → se deshace (409). */
const sinHorasCheck = (id: string): PostWriteCheck => ({
  name: "clienteSinHoras",
  run: async () => ((await tieneHoras(id)) ? conHorasConflict : null),
});

/** Mensaje para un proyecto que no se puede asignar a un Cliente: sin valor hora/moneda tiene su propio texto. */
async function motivoNoAsignable(ids: readonly string[], allowed: ReadonlySet<string>): Promise<string> {
  const proyectos = await proyectosPorId();
  const malos = ids.filter((id) => !allowed.has(id));
  return malos.some((id) => proyectos.has(id) && !conValorHora(proyectos.get(id)!)) ? USUARIO_MESSAGES.clienteSinValorHora : FIELD_MESSAGES.link;
}

function toFields(values: Values): Fields {
  const out: Fields = {};
  for (const [key, fieldId] of Object.entries(KEY_TO_FIELD)) {
    if (!(key in values)) continue;
    const v = values[key];
    out[fieldId] = key === "socio" || key === "proyectosAsignados" ? ((v as string[] | null) ?? []) : v;
  }
  return out;
}

const DUPLICATE_ERRORS = { email: USUARIO_MESSAGES.emailDuplicado, sigla: USUARIO_MESSAGES.siglaDuplicada } as const;

/** Verificaciones de unicidad (email, sigla) para las claves escritas. */
function uniqueChecks(id: string, fields: Fields, mode: "create" | "edit"): PostWriteCheck[] {
  return (["email", "sigla"] as const)
    .filter((key) => KEY_TO_FIELD[key] in fields)
    .map((key) => ({
      name: `unique:${key}`,
      run: async () =>
        (await losesUniqueRace(TABLES.usuarios.id, KEY_TO_FIELD[key], fields[KEY_TO_FIELD[key]], id, mode))
          ? { error: ABM_MESSAGES.validacion, fieldErrors: { [key]: DUPLICATE_ERRORS[key] } }
          : null,
    }));
}

/** Verificación de «al menos un Admin activo», con el error que corresponde a cada pantalla. */
const lastAdminCheck = (conflict: CheckConflict): PostWriteCheck => ({
  name: "ultimoAdmin",
  run: async () => ((await activeAdminIds()).length === 0 ? conflict : null),
});

/** Corre las verificaciones (fail-closed, compartido con Maestros) e invalida el caché del usuario. */
async function verify(tx: Compensation, id: string, checks: PostWriteCheck[]): Promise<ServiceResult<{ id: string }>> {
  const failed = await runPostWriteChecks(tx, id, checks);
  invalidateCachedUser(id);
  return failed ?? { ok: true, data: { id } };
}

/** ¿Este write podía dejar la base sin Admins activos? (era Admin activo y deja de serlo) */
const removesActiveAdmin = (existing: Fields, after: { rol?: unknown; estado?: unknown }) =>
  existing[U.rol] === "Admin" &&
  existing[U.estado] === "Activo" &&
  ((after.rol ?? existing[U.rol]) !== "Admin" || (after.estado ?? existing[U.estado]) !== "Activo");

export async function createUsuario(raw: RawValues): Promise<ServiceResult<{ id: string }>> {
  const { values, errors, password } = validateUsuario(raw, "create");
  if (Object.keys(errors).length > 0) return fail(400, ABM_MESSAGES.validacion, errors);
  const problem = await checkLinksAndUnique(values);
  if (problem) return fail(problem.status, ABM_MESSAGES.validacion, problem.errors);

  const fields = { ...toFields(values), [U.estado]: "Activo" };
  const id = await createUserWithTemporaryPassword(fields, password!);
  const tx = new Compensation();
  tx.created(TABLES.usuarios.id, id);

  return verify(tx, id, [...uniqueChecks(id, fields, "create"), ...(values.rol === "Cliente" ? [clienteProyectosCheck(id)] : [])]);
}

export async function updateUsuario(actor: Actor, id: string, raw: RawValues): Promise<ServiceResult<{ id: string }>> {
  if (!isRecordId(id)) return fail(404, ABM_MESSAGES.noEncontrado);
  const existing = await getUsuario(id);
  if (!existing) return fail(404, ABM_MESSAGES.noEncontrado);

  const { values, errors } = validateUsuario(raw, "edit");
  if (Object.keys(errors).length > 0) return fail(400, ABM_MESSAGES.validacion, errors);

  const pasaACliente = values.rol === "Cliente" && existing[U.rol] !== "Cliente";
  if (values.rol !== existing[U.rol]) {
    if (id === actor.id) return fail(409, USUARIO_MESSAGES.propioRol, { rol: USUARIO_MESSAGES.propioRol });
    // Un usuario con horas (como Colaborador o Cargado por) no puede pasar a Cliente.
    if (pasaACliente && (await tieneHoras(id))) return fail(409, conHorasConflict.error, conHorasConflict.fieldErrors);
    if (values.rol !== "Admin" && (await wouldRemoveLastAdmin(id, existing))) {
      return fail(409, USUARIO_MESSAGES.ultimoAdmin, { rol: USUARIO_MESSAGES.ultimoAdmin });
    }
  }

  const problem = await checkLinksAndUnique(values, id, existing);
  if (problem) return fail(problem.status, ABM_MESSAGES.validacion, problem.errors);

  // Si pasa a Admin, los proyectos asignados no se tocan (quedan guardados, ocultos).
  const fields = toFields(values);
  const tx = new Compensation();
  await tx.update(TABLES.usuarios.id, [{ id, fields, previous: previousOf(fields, existing) }]);
  invalidateCachedUser(id);

  const checks = removesActiveAdmin(existing, { rol: values.rol })
    ? [lastAdminCheck({ error: USUARIO_MESSAGES.ultimoAdmin, fieldErrors: { rol: USUARIO_MESSAGES.ultimoAdmin } })]
    : [];
  if (values.rol === "Cliente") checks.push(clienteProyectosCheck(id));
  if (pasaACliente) checks.push(sinHorasCheck(id));
  return verify(tx, id, [...checks, ...uniqueChecks(id, fields, "edit")]);
}

export async function setUsuarioActivo(actor: Actor, id: string, activo: unknown): Promise<ServiceResult<{ id: string }>> {
  if (!isRecordId(id)) return fail(404, ABM_MESSAGES.noEncontrado);
  if (typeof activo !== "boolean") return fail(400, ABM_MESSAGES.validacion);
  const existing = await getUsuario(id);
  if (!existing) return fail(404, ABM_MESSAGES.noEncontrado);

  if (!activo) {
    if (id === actor.id) return fail(409, USUARIO_MESSAGES.propioDesactivar);
    if (await wouldRemoveLastAdmin(id, existing)) return fail(409, USUARIO_MESSAGES.ultimoAdmin);
  }
  // Activar un Cliente: sus proyectos tienen que cumplir las reglas de hoy (mientras estuvo Inactivo pudieron cambiar).
  const activaCliente = activo && existing[U.rol] === "Cliente";
  if (activaCliente) {
    const problema = problemaProyectosCliente((existing[U.proyectosAsignados] as string[] | undefined) ?? [], await proyectosPorId());
    if (problema) return fail(409, problema, { proyectosAsignados: problema });
  }
  const fields = { [U.estado]: activo ? "Activo" : "Inactivo" };
  const tx = new Compensation();
  await tx.update(TABLES.usuarios.id, [{ id, fields, previous: previousOf(fields, existing) }]);
  invalidateCachedUser(id);

  // Dos desactivaciones a la vez pueden pasar el chequeo previo: se verifica después.
  const checks = removesActiveAdmin(existing, { estado: fields[U.estado] }) ? [lastAdminCheck({ error: USUARIO_MESSAGES.ultimoAdmin })] : [];
  if (activaCliente) checks.push(clienteProyectosCheck(id));
  return verify(tx, id, checks);
}

export async function resetUsuarioPassword(actor: Actor, id: string, password: unknown): Promise<ServiceResult<{ id: string }>> {
  if (!isRecordId(id)) return fail(404, ABM_MESSAGES.noEncontrado);
  if (id === actor.id) return fail(409, USUARIO_MESSAGES.propiaPassword);
  const problem = validateTemporaryPassword(password);
  if (problem) return fail(400, ABM_MESSAGES.validacion, { password: problem });
  if (!(await getUsuario(id))) return fail(404, ABM_MESSAGES.noEncontrado);
  await setTemporaryPassword(id, password as string);
  return { ok: true, data: { id } };
}
