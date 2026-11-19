import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { field, formula, or } from "@/lib/airtable/formula";
import { TABLES } from "@/lib/airtable/schema";
import { displayDate } from "@/lib/horas/dates";
import { KIND_LABEL, type Kind } from "@/lib/ventas-compras/columns";

/**
 * Tabla «Sincronizaciones ARCA» (CC-F5-03): un registro por sincronización. Es también la
 * fuente de las guardas (compartida entre instancias, como lib/auth/lockout.ts):
 * - una sola sincronización «En proceso» por tabla iniciada en los últimos 15 minutos;
 * - 5 sincronizaciones de un Admin terminadas en «Error» dentro de 15 minutos bloquean
 *   nuevas por 15 minutos (para no bloquear la clave fiscal en ARCA).
 * Si no se puede leer, se falla cerrado (503). Nunca se guarda CUIT, usuario ARCA ni clave.
 */

const T = TABLES.sincronizacionesArca;
const F = T.fields;

export type EstadoSync = (typeof T.choices.estado)[number];
export const SYNC_WINDOW_MS = 15 * 60 * 1000;
/**
 * Un inicio tarda como máximo lo que dura su función (maxDuration de sincronizar = 60 s). Un log
 * «En proceso» sin Job ID más viejo que esto no tiene ningún inicio vivo detrás (p. ej. un
 * inicio duplicado que no se pudo borrar ni pasar a «Vencida»): no cuenta como en curso.
 */
export const START_WINDOW_MS = 60 * 1000;
export const MAX_ERRORES = 5;

export const SYNC_LOG_MESSAGES = {
  enCurso: (kind: Kind) => `Ya hay una sincronización de ${KIND_LABEL[kind].titulo} en curso. Esperá a que termine.`,
  bloqueado: "Demasiados intentos fallidos. Esperá 15 minutos para no bloquear tu clave fiscal en ARCA.",
  noDisponible: "No pudimos verificar las sincronizaciones anteriores. Probá de nuevo en unos minutos.",
} as const;

export interface SyncRecord {
  id: string;
  tipo: Kind | null;
  desde: string | null;
  hasta: string | null;
  usuarioId: string | null;
  jobId: string | null;
  estado: EstadoSync | null;
  mensaje: string | null;
  /** ms desde epoch, o NaN */
  iniciada: number;
  finalizada: number;
}

const READ_FIELDS = [F.tipo, F.desde, F.hasta, F.usuario, F.jobId, F.estado, F.mensaje, F.iniciada, F.finalizada];
const KIND_BY_TIPO: Record<string, Kind> = { Ventas: "ventas", Compras: "compras" };

function toRecord(r: { id: string; fields: Record<string, unknown> }): SyncRecord {
  const f = r.fields;
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const usuario = Array.isArray(f[F.usuario]) && typeof (f[F.usuario] as unknown[])[0] === "string" ? (f[F.usuario] as string[])[0] : null;
  return {
    id: r.id,
    tipo: KIND_BY_TIPO[String(f[F.tipo] ?? "")] ?? null,
    desde: str(f[F.desde]),
    hasta: str(f[F.hasta]),
    usuarioId: usuario,
    jobId: str(f[F.jobId]),
    estado: (T.choices.estado as readonly string[]).includes(String(f[F.estado])) ? (f[F.estado] as EstadoSync) : null,
    mensaje: str(f[F.mensaje]),
    iniciada: typeof f[F.iniciada] === "string" ? Date.parse(f[F.iniciada] as string) : NaN,
    finalizada: typeof f[F.finalizada] === "string" ? Date.parse(f[F.finalizada] as string) : NaN,
  };
}

const TIME_FMT = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** «Ventas · 01/10/2026–31/10/2026 · 19/11/2026 14:05:09» */
export function syncName(kind: Kind, desde: string, hasta: string, now: Date): string {
  return `${KIND_LABEL[kind].titulo} · ${displayDate(desde)}–${displayDate(hasta)} · ${TIME_FMT.format(now).replace(",", "")}`;
}

export async function readSync(id: string): Promise<SyncRecord | null> {
  const rec = await getAirtableClient().get(T.id, id, { fields: READ_FIELDS });
  return rec ? toRecord(rec as { id: string; fields: Record<string, unknown> }) : null;
}

/** Alta «En proceso» (antes de llamar a Afip SDK: la guarda de concurrencia la ve enseguida). */
export async function createSync(kind: Kind, desde: string, hasta: string, userId: string, now: Date): Promise<string> {
  const [rec] = await getAirtableClient().create(
    T.id,
    [
      {
        [F.sincronizacion]: syncName(kind, desde, hasta, now),
        [F.tipo]: KIND_LABEL[kind].titulo,
        [F.desde]: desde,
        [F.hasta]: hasta,
        [F.usuario]: [userId],
        [F.estado]: "En proceso",
        [F.iniciada]: now.toISOString(),
      },
    ],
    { returnFields: [] },
  );
  return rec.id;
}

export interface SyncPatch {
  estado?: EstadoSync;
  jobId?: string;
  mensaje?: string | null;
  finalizada?: Date;
  counts?: Partial<Record<"leidas" | "nuevas" | "yaImportadas" | "duplicadas" | "conError" | "importadas", number>>;
}

export async function updateSync(id: string, patch: SyncPatch): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (patch.estado) fields[F.estado] = patch.estado;
  if (patch.jobId !== undefined) fields[F.jobId] = patch.jobId;
  if (patch.mensaje !== undefined) fields[F.mensaje] = patch.mensaje;
  if (patch.finalizada) fields[F.finalizada] = patch.finalizada.toISOString();
  for (const [k, v] of Object.entries(patch.counts ?? {})) fields[F[k as keyof typeof F]] = v;
  await getAirtableClient().update(T.id, [{ id, fields }], { returnFields: [] });
}

/** Actualiza el log sin cortar la respuesta si falla (se loguea solo el ID). */
export async function updateSyncQuiet(id: string, patch: SyncPatch): Promise<void> {
  try {
    await updateSync(id, patch);
  } catch {
    // Solo el ID: nada del error (podría traer valores).
    console.error("[arca] No se pudo actualizar el log de la sincronización", { id });
  }
}

export async function deleteSync(id: string): Promise<void> {
  await getAirtableClient().delete(T.id, [id]);
}

/** Sincronizaciones iniciadas o terminadas en los últimos `ms` (se vuelve a filtrar en código). */
async function recent(now: number, ms: number): Promise<SyncRecord[]> {
  const cutoff = new Date(now - ms).toISOString();
  const records = await getAirtableClient().list(T.id, {
    fields: READ_FIELDS,
    filterByFormula: or(formula`IS_AFTER(${field(F.iniciada)}, DATETIME_PARSE(${cutoff}))`, formula`IS_AFTER(${field(F.finalizada)}, DATETIME_PARSE(${cutoff}))`),
  });
  return records.map((r) => toRecord(r as { id: string; fields: Record<string, unknown> }));
}

const inWindow = (t: number, now: number, ms: number) => Number.isFinite(t) && t >= now - ms && t <= now + 60_000;

/**
 * «En proceso» vivas de esta tabla: iniciadas en los últimos 15 minutos y con Job ID, o sin Job ID
 * pero dentro de la ventana de un inicio. «Vencida», «Error» y el resto nunca cuentan.
 */
const running = (list: readonly SyncRecord[], kind: Kind, now: number) =>
  list.filter((s) => s.tipo === kind && s.estado === "En proceso" && inWindow(s.iniciada, now, SYNC_WINDOW_MS) && (s.jobId !== null || inWindow(s.iniciada, now, START_WINDOW_MS)));

/**
 * ¿El Admin está bloqueado? 5 «Error» dentro de 15 minutos bloquean por 15 minutos desde el
 * quinto: se buscan 5 errores consecutivos (por Finalizada) en ≤ 15 min con el último hace < 15 min.
 */
export function isBlocked(list: readonly SyncRecord[], userId: string, now: number): boolean {
  const times = list
    .filter((s) => s.usuarioId === userId && s.estado === "Error" && inWindow(s.finalizada, now, 2 * SYNC_WINDOW_MS))
    .map((s) => s.finalizada)
    .sort((a, b) => a - b);
  for (let i = MAX_ERRORES - 1; i < times.length; i++) {
    if (times[i] - times[i - MAX_ERRORES + 1] <= SYNC_WINDOW_MS && now - times[i] < SYNC_WINDOW_MS) return true;
  }
  return false;
}

export type GuardResult = { ok: true } | { ok: false; status: 409 | 429 | 503; error: string };

/** Guardas antes de empezar. Falla cerrado si no puede leer. */
export async function checkGuards(kind: Kind, userId: string, now: number): Promise<GuardResult> {
  let list: SyncRecord[];
  try {
    list = await recent(now, 2 * SYNC_WINDOW_MS);
  } catch {
    console.error("[arca] No se pudo leer Sincronizaciones ARCA");
    return { ok: false, status: 503, error: SYNC_LOG_MESSAGES.noDisponible };
  }
  if (isBlocked(list, userId, now)) return { ok: false, status: 429, error: SYNC_LOG_MESSAGES.bloqueado };
  if (running(list, kind, now).length > 0) return { ok: false, status: 409, error: SYNC_LOG_MESSAGES.enCurso(kind) };
  return { ok: true };
}

/**
 * Verificación posterior al alta (fail-closed): si otra sincronización de la misma tabla
 * quedó «En proceso» antes que la nuestra (carrera), perdemos. Desempate: Iniciada y luego ID.
 */
export async function losesRunningRace(kind: Kind, ownId: string, now: number): Promise<boolean> {
  const list = running(await recent(now, SYNC_WINDOW_MS), kind, now);
  const own = list.find((s) => s.id === ownId);
  const ownStart = own?.iniciada ?? now;
  return list.some((s) => s.id !== ownId && (s.iniciada < ownStart || (s.iniciada === ownStart && s.id < ownId)));
}
