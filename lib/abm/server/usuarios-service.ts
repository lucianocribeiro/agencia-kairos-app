import "server-only";

import { getAirtableClient, type Fields } from "@/lib/airtable/client";
import { isUnique } from "@/lib/airtable/integrity";
import { TABLES } from "@/lib/airtable/schema";
import { FIELD_MESSAGES, type FieldErrors, type RawValues, type Values } from "@/lib/abm/fields";
import type { AbmData, LinkOption, RecordDTO, ServiceResult } from "@/lib/abm/types";
import { USUARIO_MESSAGES, validateTemporaryPassword, validateUsuario } from "@/lib/abm/usuarios";
import { createUserWithTemporaryPassword, setTemporaryPassword } from "@/lib/auth/credentials";
import { invalidateCachedUser } from "@/lib/auth/user-cache";
import { ABM_MESSAGES } from "./maestros-service";

/**
 * ABM de Usuarios (Admin). Nunca lee ni devuelve el hash: las escrituras de
 * contraseña pasan por lib/auth/credentials.ts (hashNewPassword).
 *
 * Reglas de seguridad (servidor):
 * - un Admin no puede desactivarse ni cambiarse el rol a sí mismo
 * - no se puede desactivar ni pasar a Empleado al último Admin activo (409)
 * - toda escritura invalida el caché de sesión de ese usuario en esta instancia
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
  const [socios, proyectos] = await Promise.all([
    client.list(TABLES.socios.id, { fields: [S.sigla, S.nombre] }),
    client.list(TABLES.proyectos.id, { fields: [P.codigo, P.estado] }),
  ]);
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
      // Solo proyectos activos se pueden asignar.
      proyectosAsignados: proyectos
        .filter((r) => r.fields[P.estado] === "Activo")
        .map((r) => ({ id: r.id, label: proyectoLabel(r.fields) }))
        .sort(sort),
    },
  };
}

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
  for (const key of ["socio", "proyectosAsignados"] as const) {
    const ids = values[key];
    if (!Array.isArray(ids) || ids.length === 0) continue;
    const allowed = new Set([...options[key].map((o) => o.id), ...((existing?.[KEY_TO_FIELD[key]] as string[] | undefined) ?? [])]);
    if (ids.some((id) => !allowed.has(id))) errors[key] = FIELD_MESSAGES.link;
  }
  if (Object.keys(errors).length > 0) return { status: 400, errors };

  if (!(await isUnique(TABLES.usuarios.id, U.email, values.email, { excludeId }))) errors.email = USUARIO_MESSAGES.emailDuplicado;
  if (!(await isUnique(TABLES.usuarios.id, U.sigla, values.sigla, { excludeId }))) errors.sigla = USUARIO_MESSAGES.siglaDuplicada;
  return Object.keys(errors).length > 0 ? { status: 409, errors } : null;
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

export async function createUsuario(raw: RawValues): Promise<ServiceResult<{ id: string }>> {
  const { values, errors, password } = validateUsuario(raw, "create");
  if (Object.keys(errors).length > 0) return fail(400, ABM_MESSAGES.validacion, errors);
  const problem = await checkLinksAndUnique(values);
  if (problem) return fail(problem.status, ABM_MESSAGES.validacion, problem.errors);

  const id = await createUserWithTemporaryPassword({ ...toFields(values), [U.estado]: "Activo" }, password!);
  return { ok: true, data: { id } };
}

export async function updateUsuario(actor: Actor, id: string, raw: RawValues): Promise<ServiceResult<{ id: string }>> {
  if (!isRecordId(id)) return fail(404, ABM_MESSAGES.noEncontrado);
  const existing = await getUsuario(id);
  if (!existing) return fail(404, ABM_MESSAGES.noEncontrado);

  const { values, errors } = validateUsuario(raw, "edit");
  if (Object.keys(errors).length > 0) return fail(400, ABM_MESSAGES.validacion, errors);

  if (values.rol !== existing[U.rol]) {
    if (id === actor.id) return fail(409, USUARIO_MESSAGES.propioRol, { rol: USUARIO_MESSAGES.propioRol });
    if (values.rol !== "Admin" && (await wouldRemoveLastAdmin(id, existing))) {
      return fail(409, USUARIO_MESSAGES.ultimoAdmin, { rol: USUARIO_MESSAGES.ultimoAdmin });
    }
  }

  const problem = await checkLinksAndUnique(values, id, existing);
  if (problem) return fail(problem.status, ABM_MESSAGES.validacion, problem.errors);

  // Si pasa a Admin, los proyectos asignados no se tocan (quedan guardados, ocultos).
  await getAirtableClient().update(TABLES.usuarios.id, [{ id, fields: toFields(values) }], { returnFields: [] });
  invalidateCachedUser(id);
  return { ok: true, data: { id } };
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
  await getAirtableClient().update(TABLES.usuarios.id, [{ id, fields: { [U.estado]: activo ? "Activo" : "Inactivo" } }], {
    returnFields: [],
  });
  invalidateCachedUser(id);
  return { ok: true, data: { id } };
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
