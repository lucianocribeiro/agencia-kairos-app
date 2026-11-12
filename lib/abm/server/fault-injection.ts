import "server-only";

import { AirtableError } from "@/lib/airtable/errors";

/**
 * Inyección de fallas SOLO para el smoke test manual con `next dev`.
 *
 * Doble compuerta:
 * 1. `process.env.NODE_ENV === "development"`: Next reemplaza NODE_ENV por
 *    "production" al compilar `next build`, así que en producción la función
 *    queda en `return` y el resto es código muerto (check:bundle verifica que el
 *    nombre de la variable no quede en .next/server).
 * 2. La variable KAIROS_FAULT_INJECTION tiene que nombrar el punto, p. ej.
 *    `KAIROS_FAULT_INJECTION=cascade:clientes npm run dev`.
 *
 * Puntos: `cascade:proyectos:<n>` (antes del lote n de proyectos) y
 * `cascade:clientes` (antes de escribir el cliente).
 */
export function injectFault(point: string): void {
  if (process.env.NODE_ENV !== "development") return;
  const configured = process.env.KAIROS_FAULT_INJECTION;
  if (!configured || !configured.split(",").map((p) => p.trim()).includes(point)) return;
  console.warn(`[fault-injection] falla inyectada en ${point}`);
  throw new AirtableError({ code: "server_error", status: 500, message: `Falla inyectada (${point})` });
}
