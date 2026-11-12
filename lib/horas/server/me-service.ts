import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { TABLES } from "@/lib/airtable/schema";
import type { RawValues } from "@/lib/abm/fields";
import type { ServiceResult } from "@/lib/abm/types";
import { todayInBuenosAires } from "../dates";
import { HORA_MESSAGES, validateHora } from "../rules";
import { formatTime, sumHours } from "../time";
import { findOverlaps, horaFields, listHorasInRange, overlapConflict, sortHoras } from "./repo";
import { fail, resolveRange, writeHora } from "./write";

import type { MiHoraDTO, MisHorasData, MisProyectos, ProyectoRef } from "../types";
export type { MiHoraDTO, MisHorasData, MisProyectos, ProyectoRef } from "../types";

/**
 * Mis horas (Empleado). Todo se filtra en el servidor por el usuario de la
 * sesión, y las respuestas son DTOs armados a mano: nunca valor hora, moneda,
 * importe ni cliente (ni sus IDs de campo).
 */

const U = TABLES.usuarios.fields;
const P = TABLES.proyectos.fields;




const byCodigo = (a: ProyectoRef, b: ProyectoRef) => a.codigo.localeCompare(b.codigo, "es", { numeric: true });

/** Proyectos (solo Código y Estado; nunca valor hora ni moneda). */
async function proyectosById(): Promise<Map<string, { codigo: string; estado: string | null }>> {
  const rows = await getAirtableClient().list(TABLES.proyectos.id, { fields: [P.codigo, P.estado] });
  return new Map(rows.map((r) => [r.id, { codigo: String(r.fields[P.codigo] ?? ""), estado: (r.fields[P.estado] as string) ?? null }]));
}

/**
 * Asignaciones leídas de Airtable en este momento (no del caché de sesión):
 * quitarle un proyecto a alguien corta la carga en el próximo request.
 */
export async function loadMisProyectos(userId: string): Promise<MisProyectos> {
  const [user, proyectos] = await Promise.all([
    getAirtableClient().get(TABLES.usuarios.id, userId, { fields: [U.proyectosAsignados, U.estado] }),
    proyectosById(),
  ]);
  const ids = user && user.fields[U.estado] === "Activo" ? ((user.fields[U.proyectosAsignados] as string[] | undefined) ?? []) : [];
  const asignados = ids.filter((id) => proyectos.has(id)).map((id) => ({ id, codigo: proyectos.get(id)!.codigo }));
  return {
    asignados: asignados.sort(byCodigo),
    activos: asignados.filter((p) => proyectos.get(p.id)!.estado === "Activo").sort(byCodigo),
  };
}

export interface MisHorasQuery {
  desde: string | null;
  hasta: string | null;
  proyecto: string | null;
}


export async function listMisHoras(userId: string, query: MisHorasQuery, now = new Date()): Promise<ServiceResult<MisHorasData>> {
  const resolved = resolveRange(query.desde, query.hasta, todayInBuenosAires(now));
  if ("error" in resolved) return fail(400, resolved.error);
  const [mis, proyectos, horas] = await Promise.all([loadMisProyectos(userId), proyectosById(), listHorasInRange(resolved.range)]);
  if (query.proyecto && !mis.asignados.some((p) => p.id === query.proyecto)) return fail(400, HORA_MESSAGES.noAsignado);

  const mine = horas.filter((h) => h.colaborador === userId && (!query.proyecto || h.proyecto === query.proyecto));
  const records: MiHoraDTO[] = sortHoras(mine).map((h) => ({
    id: h.id,
    fecha: h.fecha!,
    proyecto: { id: h.proyecto ?? "", codigo: (h.proyecto && proyectos.get(h.proyecto)?.codigo) || "" },
    tarea: h.tarea,
    desde: formatTime(h.desde),
    hasta: formatTime(h.hasta),
    horas: h.horas,
  }));
  return { ok: true, data: { range: resolved.range, records, total: sumHours(records.map((r) => r.horas)) } };
}

/**
 * Alta por un Empleado. Colaborador = Cargado por = el usuario de la sesión,
 * Facturable = sí, Mes a facturar vacío: nada de eso se acepta del body.
 */
export async function createMiHora(userId: string, raw: RawValues, now = new Date()): Promise<ServiceResult<{ id: string }>> {
  const { values, errors } = validateHora(raw, "empleado");
  if (!values) return fail(400, HORA_MESSAGES.validacion, errors);
  if (values.fecha > todayInBuenosAires(now)) return fail(400, HORA_MESSAGES.futura, { fecha: HORA_MESSAGES.futura });

  const mis = await loadMisProyectos(userId);
  if (!mis.activos.some((p) => p.id === values.proyecto)) return fail(403, HORA_MESSAGES.noAsignado, { proyecto: HORA_MESSAGES.noAsignado });

  const slot = { colaborador: userId, fecha: values.fecha, desde: values.desde, hasta: values.hasta };
  const overlaps = await findOverlaps(slot);
  if (overlaps.length > 0) {
    const c = overlapConflict(overlaps);
    return fail(409, c.error, c.fieldErrors);
  }

  const fields = horaFields({
    fecha: values.fecha,
    proyecto: values.proyecto,
    tarea: values.tarea,
    desde: values.desde,
    hasta: values.hasta,
    colaborador: userId,
    cargadoPor: userId,
    facturable: true,
  });
  return writeHora({ mode: "create" }, fields, slot);
}
