import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { and, eq, field, formula } from "@/lib/airtable/formula";
import { TABLES } from "@/lib/airtable/schema";
import { describeError } from "./users";

/**
 * Bloqueo temporal por intentos fallidos, sobre la tabla "Intentos de login".
 *
 * - Email: 5+ Fallido en los últimos 15 min, contando solo los posteriores
 *   al último Exitoso de ese email.
 * - IP: 20+ Fallido desde esa IP en los últimos 15 min.
 *
 * Nunca se guardan contraseñas ni hashes acá.
 */

const T = TABLES.intentosLogin;
const F = T.fields;

export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILS_PER_EMAIL = 5;
export const MAX_FAILS_PER_IP = 20;

export type Resultado = (typeof T.choices.resultado)[number];

type IntentoFields = {
  [F.email]: string;
  [F.ip]: string;
  [F.resultado]: Resultado;
  [F.fecha]: string;
};

/** La lectura del bloqueo falló: el login falla cerrado (503). */
export class LockoutUnavailableError extends Error {
  constructor() {
    super("No se pudo leer el registro de intentos de login");
    this.name = "LockoutUnavailableError";
  }
}

function inWindow(fecha: unknown, cutoff: number, now: number): fecha is string {
  if (typeof fecha !== "string") return false;
  const t = Date.parse(fecha);
  return Number.isFinite(t) && t >= cutoff && t <= now + 60_000;
}

/** ¿Está bloqueado este email o esta IP? Lanza LockoutUnavailableError si no puede leer. */
export async function isLockedOut(email: string, ip: string, now: Date = new Date()): Promise<boolean> {
  const nowMs = now.getTime();
  const cutoff = nowMs - LOCKOUT_WINDOW_MS;
  const cutoffIso = new Date(cutoff).toISOString();
  const recent = formula`IS_AFTER(${field(F.fecha)}, DATETIME_PARSE(${cutoffIso}))`;
  const client = getAirtableClient();

  try {
    const [byEmail, byIp] = await Promise.all([
      client.list<IntentoFields>(T.id, {
        fields: [F.email, F.resultado, F.fecha],
        filterByFormula: and(eq(F.email, email), recent),
      }),
      client.list<IntentoFields>(T.id, {
        fields: [F.ip, F.resultado, F.fecha],
        filterByFormula: and(eq(F.ip, ip), eq(F.resultado, "Fallido"), recent),
        maxRecords: MAX_FAILS_PER_IP,
      }),
    ]);

    // Se vuelve a filtrar en código: no depende solo de la fórmula.
    const emailAttempts = byEmail
      .map((r) => r.fields)
      .filter((f) => f[F.email] === email && inWindow(f[F.fecha], cutoff, nowMs))
      .map((f) => ({ resultado: f[F.resultado], at: Date.parse(f[F.fecha]!) }));

    const lastSuccess = Math.max(
      -Infinity,
      ...emailAttempts.filter((a) => a.resultado === "Exitoso").map((a) => a.at),
    );
    const emailFails = emailAttempts.filter((a) => a.resultado === "Fallido" && a.at > lastSuccess).length;

    const ipFails = byIp
      .map((r) => r.fields)
      .filter((f) => f[F.ip] === ip && f[F.resultado] === "Fallido" && inWindow(f[F.fecha], cutoff, nowMs)).length;

    return emailFails >= MAX_FAILS_PER_EMAIL || ipFails >= MAX_FAILS_PER_IP;
  } catch (err) {
    console.error("[auth] No se pudo leer Intentos de login", describeError(err));
    throw new LockoutUnavailableError();
  }
}

/** Registra un intento. Si la escritura falla, se loguea y no corta el login. */
export async function recordAttempt(
  email: string,
  ip: string,
  resultado: Resultado,
  now: Date = new Date(),
): Promise<void> {
  try {
    await getAirtableClient().create<IntentoFields>(
      T.id,
      [{ [F.email]: email, [F.ip]: ip, [F.resultado]: resultado, [F.fecha]: now.toISOString() }],
      { returnFields: [] },
    );
  } catch (err) {
    console.error("[auth] No se pudo registrar el intento de login", describeError(err));
  }
}
