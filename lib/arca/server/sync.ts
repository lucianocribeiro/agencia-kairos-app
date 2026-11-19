import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { TABLES } from "@/lib/airtable/schema";
import type { ServiceResult } from "@/lib/abm/types";
import { adaptArcaRows } from "@/lib/arca/adapter";
import type { SessionUser } from "@/lib/auth/session";
import { describeError } from "@/lib/auth/users";
import { parseCuit } from "@/lib/cuit";
import { getEnv } from "@/lib/env";
import { daysBetween, displayDate, isIsoDate, todayInBuenosAires } from "@/lib/horas/dates";
import type { Kind } from "@/lib/ventas-compras/columns";
import { confirmSheet, previewSheet } from "@/lib/ventas-compras/server/service";
import type { Preview, ResultadoImportacion } from "@/lib/ventas-compras/types";
import { AFIP_SDK_MESSAGES, AfipSdkClient, AfipSdkError, afipSdkErrorResponse } from "./afipsdk";
import type { ArcaConfig } from "./config";
import { PAYLOAD_MESSAGES, signPayload, verifyPayload } from "./payload";
import { checkGuards, createSync, deleteSync, losesRunningRace, readSync, SYNC_LOG_MESSAGES, SYNC_WINDOW_MS, updateSync, updateSyncQuiet, type SyncRecord } from "./sync-log";

/**
 * Sincronización con ARCA vía Afip SDK (CC-F5-03), en pedidos cortos:
 * 1. startSync: valida, guardas, log «En proceso», crea el job → { syncId }.
 * 2. pollSync: un GET del job por llamada (el navegador consulta cada 5 s). Completo →
 *    adaptador → la misma vista previa que el .xlsx + payload firmado.
 * 3. confirmSync: verifica firma y claims → adaptador + parse + confirmImport, como el .xlsx.
 *
 * Credenciales (usuario ARCA y clave fiscal): solo existen dentro de startSync, en el pedido
 * a Afip SDK. Nunca se guardan, loguean ni devuelven.
 */

export const T_ARCA: Record<Kind, "E" | "R"> = { ventas: "E", compras: "R" };
export const PARAM_CUIT = "CUIT";

export const SYNC_MESSAGES = {
  campos: "El pedido tiene campos que no se esperan.",
  fechas: "Elegí las fechas Desde y Hasta.",
  orden: "La fecha Desde no puede ser posterior a Hasta.",
  futuro: "La fecha Hasta no puede ser posterior a hoy.",
  rango: "El período no puede superar los 366 días.",
  usuario: "El usuario de ARCA tiene que ser una CUIT válida.",
  clave: "Escribí la clave fiscal.",
  cuitEmpresa: "Completá la CUIT de la empresa en Parámetros antes de sincronizar con ARCA.",
  carrera: (titulo: string) => `Ya hay una sincronización de ${titulo} en curso. Esperá a que termine.`,
  noEncontrada: "No encontramos esa sincronización.",
  otroUsuario: "Esta sincronización es de otro usuario.",
  importada: "Esta sincronización ya se importó.",
  noLista: "La sincronización todavía no está lista para importar.",
  vencida: "La sincronización tardó más de 15 minutos y venció. Probá de nuevo.",
  conError: "La sincronización terminó con error. Probá de nuevo.",
  sinJob: "No se pudo registrar la sincronización en ARCA. Probá de nuevo.",
  errorArca: AFIP_SDK_MESSAGES.rejected,
  inicioDuplicado: "Inicio duplicado descartado.",
  inesperado: AFIP_SDK_MESSAGES.unexpected,
} as const;

const fail = (status: 400 | 403 | 404 | 409 | 413 | 429 | 500 | 503, error: string): ServiceResult<never> => ({ ok: false, status, error });
const REC_ID = /^rec[A-Za-z0-9]{14}$/;
const MAX_CLAVE = 128;

/** Mensaje que queda en el log (y que ve el Admin) para un error de Afip SDK. Nunca credenciales. */
export const mensajeDeError = (err: AfipSdkError): string => afipSdkErrorResponse(err).error;

function onlyKeys(body: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(body).every((k) => allowed.includes(k));
}

export interface StartInput {
  desde: string;
  hasta: string;
  /** CUIT de login de ARCA, 11 dígitos. */
  usuario: string;
  clave: string;
}

/** Valida el pedido de inicio (sin tocar la base). Exportada para tests. */
export function validarInicio(body: Record<string, unknown>, now: Date): { ok: true; data: StartInput } | { ok: false; error: string } {
  // Nunca se acepta una CUIT de empresa (ni nada más) desde el navegador.
  if (!onlyKeys(body, ["desde", "hasta", "usuario", "clave"])) return { ok: false, error: SYNC_MESSAGES.campos };
  const { desde, hasta, usuario, clave } = body;
  if (!isIsoDate(desde) || !isIsoDate(hasta)) return { ok: false, error: SYNC_MESSAGES.fechas };
  if (desde > hasta) return { ok: false, error: SYNC_MESSAGES.orden };
  if (hasta > todayInBuenosAires(now)) return { ok: false, error: SYNC_MESSAGES.futuro };
  if (daysBetween(desde, hasta) > 365) return { ok: false, error: SYNC_MESSAGES.rango };
  const login = typeof usuario === "string" ? parseCuit(usuario) : null;
  if (!login || "error" in login) return { ok: false, error: SYNC_MESSAGES.usuario };
  if (typeof clave !== "string" || clave.length === 0 || clave.length > MAX_CLAVE) return { ok: false, error: SYNC_MESSAGES.clave };
  return { ok: true, data: { desde, hasta, usuario: login.digits, clave } };
}

/** CUIT de la empresa: Parámetros «CUIT» (texto). null si está vacía o no es válida. */
async function companyCuit(): Promise<string | null> {
  const P = TABLES.parametros.fields;
  const rows = await getAirtableClient().list(TABLES.parametros.id, { fields: [P.concepto, P.valor] });
  const row = rows.find((r) => String(r.fields[P.concepto] ?? "").trim() === PARAM_CUIT);
  const value = row ? String(row.fields[P.valor] ?? "").trim() : "";
  if (!value) return null;
  const parsed = parseCuit(value);
  return "digits" in parsed ? parsed.digits : null;
}

const client = (config: ArcaConfig) => new AfipSdkClient({ token: config.token, baseUrl: config.baseUrl });

export async function startSync(kind: Kind, user: SessionUser, body: Record<string, unknown>, config: ArcaConfig, now: Date = new Date()): Promise<ServiceResult<{ syncId: string }>> {
  const input = validarInicio(body, now);
  if (!input.ok) return fail(400, input.error);
  const { desde, hasta } = input.data;

  const cuit = await companyCuit();
  if (!cuit) return fail(400, SYNC_MESSAGES.cuitEmpresa);

  const guard = await checkGuards(kind, user.id, now.getTime());
  if (!guard.ok) return fail(guard.status, guard.error);

  const syncId = await createSync(kind, desde, hasta, user.id, now);
  // Verificación posterior (fail-closed): dos inicios a la vez → sigue el más viejo.
  let lost: boolean;
  try {
    lost = await losesRunningRace(kind, syncId, now.getTime());
  } catch {
    console.error("[arca] Verificación posterior fallida", { id: syncId });
    await descartarInicio(syncId);
    return fail(503, SYNC_LOG_MESSAGES.noDisponible);
  }
  if (lost) {
    // Perdimos la carrera: nuestro log no llegó a ARCA. Se borra; si no se puede, queda «Vencida».
    if (!(await descartarInicio(syncId))) return fail(503, SYNC_LOG_MESSAGES.noDisponible);
    return fail(409, SYNC_LOG_MESSAGES.enCurso(kind));
  }

  let jobId: string;
  try {
    jobId = await client(config).createJob({
      cuit,
      username: input.data.usuario,
      password: input.data.clave,
      t: T_ARCA[kind],
      fechaEmision: `${displayDate(desde)} - ${displayDate(hasta)}`,
    });
  } catch (err) {
    const mensaje = err instanceof AfipSdkError ? mensajeDeError(err) : SYNC_MESSAGES.inesperado;
    await updateSyncQuiet(syncId, { estado: "Error", mensaje, finalizada: new Date() });
    console.error("[arca] Falló la creación del job", { id: syncId, error: err instanceof AfipSdkError ? err.toJSON() : describeError(err) });
    throw err;
  }
  await updateSync(syncId, { jobId });
  return { ok: true, data: { syncId } };
}

/**
 * Descarta el log de un inicio que no siguió (CC-F5-04 F-07): lo borra; si el borrado falla, lo
 * deja «Vencida» con Finalizada = ahora y «Inicio duplicado descartado.» («Vencida» no cuenta
 * para ninguna guarda). true si quedó resuelto; false si fallaron los dos (se loguea el ID).
 */
async function descartarInicio(syncId: string): Promise<boolean> {
  try {
    await deleteSync(syncId);
    return true;
  } catch {
    try {
      await updateSync(syncId, { estado: "Vencida", finalizada: new Date(), mensaje: SYNC_MESSAGES.inicioDuplicado });
      return true;
    } catch {
      console.error("[arca] No se pudo descartar el log de un inicio duplicado", { id: syncId });
      return false;
    }
  }
}

export type PollResult =
  | { estado: "en_proceso" }
  | { estado: "sin_comprobantes"; mensaje: string }
  | { estado: "lista"; preview: Preview; payload: string };

/** Termina el log en «Error» y responde 400 con el mismo mensaje. */
async function terminarConError(id: string, mensaje: string): Promise<ServiceResult<never>> {
  await updateSyncQuiet(id, { estado: "Error", mensaje, finalizada: new Date() });
  return fail(400, mensaje);
}

function checkOwner(rec: SyncRecord | null, user: SessionUser): ServiceResult<never> | null {
  if (!rec || !rec.tipo) return fail(404, SYNC_MESSAGES.noEncontrada);
  if (rec.usuarioId !== user.id) return fail(403, SYNC_MESSAGES.otroUsuario);
  return null;
}

export async function pollSync(id: string, user: SessionUser, config: ArcaConfig, now: Date = new Date()): Promise<ServiceResult<PollResult>> {
  if (!REC_ID.test(id)) return fail(404, SYNC_MESSAGES.noEncontrada);
  const rec = await readSync(id);
  const owner = checkOwner(rec, user);
  if (owner) return owner;
  const sync = rec!;
  const kind = sync.tipo!;

  if (sync.estado === "Importada") return fail(409, SYNC_MESSAGES.importada);
  if (sync.estado === "Error") return fail(400, sync.mensaje ?? SYNC_MESSAGES.conError);
  if (sync.estado === "Vencida") return fail(400, SYNC_MESSAGES.vencida);

  if (sync.estado === "En proceso" && !(now.getTime() - sync.iniciada <= SYNC_WINDOW_MS)) {
    await updateSyncQuiet(id, { estado: "Vencida", mensaje: SYNC_MESSAGES.vencida, finalizada: now });
    return fail(400, SYNC_MESSAGES.vencida);
  }
  if (!sync.jobId) {
    // El inicio puede estar todavía esperando a Afip SDK (hasta 30 s).
    if (sync.estado === "En proceso" && now.getTime() - sync.iniciada < 60_000) return { ok: true, data: { estado: "en_proceso" } };
    return terminarConError(id, SYNC_MESSAGES.sinJob);
  }

  let job;
  try {
    job = await client(config).getJob(sync.jobId);
  } catch (err) {
    if (err instanceof AfipSdkError && err.kind !== "unavailable") {
      await updateSyncQuiet(id, { estado: "Error", mensaje: mensajeDeError(err), finalizada: new Date() });
    }
    // unavailable: el log queda «En proceso» y el navegador vuelve a consultar.
    console.error("[arca] Falló la consulta del job", { id, error: err instanceof AfipSdkError ? err.toJSON() : describeError(err) });
    throw err;
  }
  if (job.status === "in_process") return { ok: true, data: { estado: "en_proceso" } };
  // Error del job: siempre el mensaje fijo (no tenemos las credenciales para limpiar el del proveedor).
  if (job.status === "error") return terminarConError(id, SYNC_MESSAGES.errorArca);

  const adapted = adaptArcaRows(kind, job.data);
  if (!adapted.ok) {
    if (adapted.code === "sin_comprobantes") {
      await updateSyncQuiet(id, {
        estado: "Lista para revisar",
        mensaje: adapted.error,
        finalizada: now,
        counts: { leidas: 0, nuevas: 0, yaImportadas: 0, duplicadas: 0, conError: 0 },
      });
      return { ok: true, data: { estado: "sin_comprobantes", mensaje: adapted.error } };
    }
    return terminarConError(id, adapted.error);
  }
  const preview = await previewSheet(kind, adapted.sheet, "arca", adapted.invalidas);
  if (!preview.ok) return preview.status === 400 ? terminarConError(id, preview.error) : preview;

  const payload = signPayload(getEnv().SESSION_SECRET, { syncId: id, tabla: kind, userId: user.id, issuedAt: now.getTime() }, adapted.rows);
  if (!payload) return terminarConError(id, PAYLOAD_MESSAGES.muyGrande);

  const r = preview.data.resumen;
  await updateSync(id, {
    estado: "Lista para revisar",
    mensaje: null,
    finalizada: now,
    counts: { leidas: r.total, nuevas: r.nuevas, yaImportadas: r.yaImportadas, duplicadas: r.duplicadas, conError: r.conError },
  });
  return { ok: true, data: { estado: "lista", preview: preview.data, payload } };
}

export async function confirmSync(kind: Kind, user: SessionUser, body: Record<string, unknown>, now: Date = new Date()): Promise<ServiceResult<ResultadoImportacion>> {
  if (!onlyKeys(body, ["syncId", "payload", "ediciones"])) return fail(400, SYNC_MESSAGES.campos);
  const { syncId, payload, ediciones } = body;
  if (typeof syncId !== "string" || !REC_ID.test(syncId)) return fail(404, SYNC_MESSAGES.noEncontrada);

  const rec = await readSync(syncId);
  const owner = checkOwner(rec, user);
  if (owner) return owner;
  const sync = rec!;
  if (sync.tipo !== kind) return fail(400, PAYLOAD_MESSAGES.otraSincronizacion);
  if (sync.estado === "Importada") return fail(409, SYNC_MESSAGES.importada);
  if (sync.estado !== "Lista para revisar") return fail(409, SYNC_MESSAGES.noLista);

  const verified = verifyPayload(getEnv().SESSION_SECRET, payload, { syncId, tabla: kind, userId: user.id }, now.getTime());
  if (!verified.ok) return fail(verified.status, verified.error);

  const adapted = adaptArcaRows(kind, verified.rows);
  if (!adapted.ok) return fail(400, adapted.error);
  const result = await confirmSheet(kind, adapted.sheet, ediciones, "arca", adapted.invalidas);
  if (!result.ok) return result;

  const r = result.data;
  await updateSyncQuiet(syncId, {
    estado: "Importada",
    finalizada: new Date(),
    counts: { importadas: r.importadas, yaImportadas: r.omitidas.yaImportadas, duplicadas: r.omitidas.duplicadasEnArchivo, conError: r.conError.length },
  });
  return result;
}
