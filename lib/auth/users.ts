import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { TABLES } from "@/lib/airtable/schema";
import { invalidateCachedUser } from "./user-cache";

const U = TABLES.usuarios.fields;

/** Actualiza "Último acceso". Si falla, se loguea y el login sigue. */
export async function touchUltimoAcceso(userId: string, now: Date = new Date()): Promise<void> {
  try {
    await getAirtableClient().update(
      TABLES.usuarios.id,
      [{ id: userId, fields: { [U.ultimoAcceso]: now.toISOString() } }],
      { returnFields: [] },
    );
  } catch (err) {
    console.error("[auth] No se pudo actualizar Último acceso", describeError(err));
  } finally {
    invalidateCachedUser(userId);
  }
}

/** Resumen seguro de un error para logs (AirtableError ya viene sin secretos). */
export function describeError(err: unknown): unknown {
  if (err && typeof err === "object" && "toJSON" in err && typeof err.toJSON === "function") return err.toJSON();
  return err instanceof Error ? { name: err.name, message: err.message } : String(err);
}
