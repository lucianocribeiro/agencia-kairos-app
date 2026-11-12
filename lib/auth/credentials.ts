import "server-only";

import { getAirtableClient, type AirtableRecord } from "@/lib/airtable/client";
import { field, formula, recordIdIs, type Formula } from "@/lib/airtable/formula";
import { TABLES } from "@/lib/airtable/schema";
import { isRole, type Role } from "@/lib/roles";
import { comparePassword, hashNewPassword, passwordFingerprint } from "./password";
import { invalidateCachedUser } from "./user-cache";

/**
 * ÚNICO módulo que lee (y escribe) Usuarios.passwordHash.
 *
 * El hash nunca sale de acá: hacia afuera solo se expone `pf` (la huella) y
 * el resultado de comparar. El test `password-hash-reader.test.ts` falla si
 * otro módulo de la app referencia el campo.
 */

const U = TABLES.usuarios.fields;

export interface AuthUser {
  id: string;
  nombre: string;
  email: string;
  rol: Role;
  activo: boolean;
  debeCambiarPassword: boolean;
  /** Huella del hash actual. null si el usuario no tiene contraseña. */
  pf: string | null;
}

type UsuarioFields = {
  [U.nombre]: string;
  [U.email]: string;
  [U.rol]: string;
  [U.estado]: string;
  [U.debeCambiarPassword]: boolean;
  [U.passwordHash]: string;
};

const AUTH_FIELDS = [U.nombre, U.email, U.rol, U.estado, U.debeCambiarPassword, U.passwordHash];

interface AuthRecord {
  user: AuthUser;
  hash: string | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAuthRecord(record: AirtableRecord<UsuarioFields>): AuthRecord | null {
  const f = record.fields;
  const rol = f[U.rol];
  if (!isRole(rol)) return null; // sin rol válido no puede entrar
  const hash = typeof f[U.passwordHash] === "string" && f[U.passwordHash] ? f[U.passwordHash]! : null;
  return {
    hash,
    user: {
      id: record.id,
      nombre: f[U.nombre] ?? "",
      email: normalizeEmail(f[U.email] ?? ""),
      rol,
      activo: f[U.estado] === "Activo",
      debeCambiarPassword: f[U.debeCambiarPassword] === true,
      pf: hash ? passwordFingerprint(hash) : null,
    },
  };
}

/** La única función que pide el campo passwordHash a Airtable. */
async function readAuthRecords(filterByFormula: Formula): Promise<AuthRecord[]> {
  const records = await getAirtableClient().list<UsuarioFields>(TABLES.usuarios.id, {
    fields: AUTH_FIELDS,
    filterByFormula,
    maxRecords: 2,
  });
  return records.map(toAuthRecord).filter((r): r is AuthRecord => r !== null);
}

/** Usuario por ID, con su `pf`. Sin el hash. */
export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const [record] = await readAuthRecords(recordIdIs(userId));
  return record?.user ?? null;
}

/**
 * Busca por LOWER(email) y compara la contraseña. Si el email no existe,
 * compara igual contra un hash fijo (mismo tiempo de respuesta).
 * Devuelve el usuario solo si la contraseña coincide (activo o no: lo decide quien llama).
 */
export async function verifyPasswordByEmail(email: string, password: string): Promise<AuthUser | null> {
  const normalized = normalizeEmail(email);
  const records = await readAuthRecords(formula`LOWER(${field(U.email)}) = ${normalized}`);
  // Doble control: Airtable ya filtró, pero se verifica en código también.
  const record = records.find((r) => r.user.email === normalized) ?? null;
  const ok = await comparePassword(password, record?.hash);
  return ok && record ? record.user : null;
}

/** Compara la contraseña actual de un usuario (para el cambio de contraseña). */
export async function verifyPasswordById(userId: string, password: string): Promise<boolean> {
  const [record] = await readAuthRecords(recordIdIs(userId));
  return comparePassword(password, record?.hash);
}

/**
 * Guarda una contraseña nueva, apaga "Debe cambiar password" y devuelve el
 * `pf` nuevo para reemitir la cookie. El hash sale de hashNewPassword (valida la política).
 */
export async function setPassword(userId: string, newPassword: string): Promise<string> {
  const hash = await hashNewPassword(newPassword);
  await getAirtableClient().update(
    TABLES.usuarios.id,
    [{ id: userId, fields: { [U.passwordHash]: hash, [U.debeCambiarPassword]: false } }],
    { returnFields: [] },
  );
  invalidateCachedUser(userId);
  return passwordFingerprint(hash);
}
