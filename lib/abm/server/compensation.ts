import "server-only";

import { getAirtableClient, type Fields } from "@/lib/airtable/client";

/**
 * Escrituras con compensación. Airtable no tiene transacciones: cada paso que
 * se escribe deja anotado cómo deshacerlo, y `rollback()` lo deshace (best
 * effort, en orden inverso). Los updates de rollback usan la política de
 * reintentos normal del cliente (429/5xx).
 *
 * - update: se anota el valor anterior ANTES de mandar el lote (si el lote
 *   falla con un 5xx puede haberse aplicado igual; volver al valor anterior es
 *   idempotente).
 * - create: se anota un delete del registro creado.
 */

export const BATCH_SIZE = 10;

export interface PlannedUpdate {
  id: string;
  fields: Fields;
  /** Valores a restaurar en el rollback (mismas claves que `fields`). */
  previous: Fields;
}

type Undo = { kind: "update"; tableId: string; records: { id: string; fields: Fields }[] } | { kind: "delete"; tableId: string; ids: string[] };

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Valores actuales de las claves de `fields`, para restaurar. Lo que no
 * estaba se restaura como vacío ([] en links, false en checkbox, null en el resto).
 */
export function previousOf(fields: Fields, existing: Fields): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key in existing && existing[key] !== undefined) out[key] = existing[key];
    else out[key] = Array.isArray(value) ? [] : typeof value === "boolean" ? false : null;
  }
  return out;
}

export class Compensation {
  readonly #undo: Undo[] = [];
  readonly #ids = new Set<string>();

  /** IDs de todos los registros que se tocaron (para el log). */
  get recordIds(): string[] {
    return [...this.#ids];
  }

  /**
   * Updates en lotes de 10. `beforeBatch(i)` corre justo antes de mandar el
   * lote i (lo usa la inyección de fallas del smoke test).
   */
  async update(tableId: string, records: readonly PlannedUpdate[], beforeBatch?: (index: number) => void): Promise<void> {
    for (const [index, batch] of chunk(records, BATCH_SIZE).entries()) {
      this.#undo.push({ kind: "update", tableId, records: batch.map((r) => ({ id: r.id, fields: r.previous })) });
      batch.forEach((r) => this.#ids.add(r.id));
      beforeBatch?.(index);
      await getAirtableClient().update(
        tableId,
        batch.map((r) => ({ id: r.id, fields: r.fields })),
        { returnFields: [] },
      );
    }
  }

  /** Crea un registro (create nunca se reintenta) y anota su borrado. */
  async create(tableId: string, fields: Fields): Promise<string> {
    const [created] = await getAirtableClient().create(tableId, [fields], { returnFields: [] });
    this.created(tableId, created.id);
    return created.id;
  }

  /** Anota un registro creado por otro módulo (p. ej. credentials.ts). */
  created(tableId: string, id: string): void {
    this.#undo.push({ kind: "delete", tableId, ids: [id] });
    this.#ids.add(id);
  }

  /** Deshace todo lo anotado. true si todos los pasos de rollback salieron bien. */
  async rollback(): Promise<boolean> {
    const client = getAirtableClient();
    let ok = true;
    for (const step of [...this.#undo].reverse()) {
      try {
        if (step.kind === "update") await client.update(step.tableId, step.records, { returnFields: [] });
        else await client.delete(step.tableId, step.ids);
      } catch {
        ok = false; // se sigue con el resto: best effort
      }
    }
    this.#undo.length = 0;
    return ok;
  }
}

/**
 * Deshace y loguea solo los IDs afectados (nada de valores ni del error).
 * Devuelve si el rollback salió bien.
 */
export async function rollbackAndLog(tx: Compensation, label: string): Promise<boolean> {
  const ids = tx.recordIds;
  const ok = await tx.rollback();
  if (ok) console.error(`[abm] ${label}: cambio revertido`, { ids });
  else console.error(`[abm] ${label}: CAMBIO INCOMPLETO, falló el rollback`, { ids });
  return ok;
}
