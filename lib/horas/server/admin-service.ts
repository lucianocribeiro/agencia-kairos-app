import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { TABLES } from "@/lib/airtable/schema";
import type { RawValues } from "@/lib/abm/fields";
import type { ServiceResult } from "@/lib/abm/types";
import { todayInBuenosAires } from "../dates";
import { HORA_MESSAGES, validateHora } from "../rules";
import { formatTime, sumHours } from "../time";
import { findOverlaps, getHora, H, horaFields, HORAS_TABLE, listHorasInRange, overlapConflict, sortHoras } from "./repo";
import { fail, resolveRange, writeHora } from "./write";

import type { HoraAdminDTO, HorasAdminData, HorasOptions, Ref } from "../types";
export type { ClienteOption, HoraAdminDTO, HorasAdminData, HorasOptions, ProyectoOption, UsuarioOption } from "../types";

/**
 * Horas (Admin): lista con filtros, alta, edición y borrado. Sin valor hora,
 * moneda ni importe (no se leen). El Cliente sale del link Cliente del proyecto.
 */

const U = TABLES.usuarios.fields;
const P = TABLES.proyectos.fields;
const C = TABLES.clientes.fields;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;

export const HORA_ADMIN_MESSAGES = {
  colaboradorInactivo: "Elegí un colaborador activo.",
  proyectoInexistente: "Elegí un proyecto válido.",
  filtro: "El filtro no es válido.",
} as const;




const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

export async function loadHorasOptions(): Promise<HorasOptions> {
  const client = getAirtableClient();
  const [usuarios, proyectos, clientes] = await Promise.all([
    client.list(TABLES.usuarios.id, { fields: [U.nombre, U.estado] }),
    client.list(TABLES.proyectos.id, { fields: [P.codigo, P.estado, P.cliente] }),
    client.list(TABLES.clientes.id, { fields: [C.nombre] }),
  ]);
  return {
    usuarios: usuarios
      .map((r) => ({ id: r.id, nombre: String(r.fields[U.nombre] ?? "") || "(sin nombre)", activo: r.fields[U.estado] === "Activo" }))
      .sort((a, b) => collator.compare(a.nombre, b.nombre)),
    proyectos: proyectos
      .map((r) => ({
        id: r.id,
        codigo: String(r.fields[P.codigo] ?? "") || "(sin código)",
        estado: (r.fields[P.estado] as string) ?? null,
        cliente: (r.fields[P.cliente] as string[] | undefined)?.[0] ?? null,
      }))
      .sort((a, b) => collator.compare(a.codigo, b.codigo)),
    clientes: clientes.map((r) => ({ id: r.id, nombre: String(r.fields[C.nombre] ?? "") || "(sin nombre)" })).sort((a, b) => collator.compare(a.nombre, b.nombre)),
  };
}

export interface HorasAdminQuery {
  desde: string | null;
  hasta: string | null;
  colaborador: string | null;
  proyecto: string | null;
  cliente: string | null;
}


/** Lista filtrada. Los filtros por link se aplican en código con los IDs que devuelve la API. */
export async function listHorasAdmin(query: HorasAdminQuery, now = new Date(), options?: HorasOptions): Promise<ServiceResult<HorasAdminData>> {
  const resolved = resolveRange(query.desde, query.hasta, todayInBuenosAires(now));
  if ("error" in resolved) return fail(400, resolved.error);
  for (const id of [query.colaborador, query.proyecto, query.cliente]) {
    if (id && !RECORD_ID_RE.test(id)) return fail(400, HORA_ADMIN_MESSAGES.filtro);
  }
  const [opts, horas] = await Promise.all([options ?? loadHorasOptions(), listHorasInRange(resolved.range)]);
  const usuarios = new Map(opts.usuarios.map((u) => [u.id, u]));
  const proyectos = new Map(opts.proyectos.map((p) => [p.id, p]));
  const clientes = new Map(opts.clientes.map((c) => [c.id, c]));
  const clienteOf = (proyectoId: string | null) => (proyectoId ? (proyectos.get(proyectoId)?.cliente ?? null) : null);

  const filtered = horas.filter(
    (h) =>
      (!query.colaborador || h.colaborador === query.colaborador) &&
      (!query.proyecto || h.proyecto === query.proyecto) &&
      (!query.cliente || clienteOf(h.proyecto) === query.cliente),
  );
  const ref = (id: string | null): Ref => (id ? { id, nombre: usuarios.get(id)?.nombre ?? "(sin nombre)" } : null);
  const records: HoraAdminDTO[] = sortHoras(filtered).map((h) => {
    const p = h.proyecto ? proyectos.get(h.proyecto) : undefined;
    const clienteId = clienteOf(h.proyecto);
    return {
      id: h.id,
      fecha: h.fecha!,
      colaborador: ref(h.colaborador),
      proyecto: h.proyecto ? { id: h.proyecto, codigo: p?.codigo ?? "(sin código)", estado: p?.estado ?? null } : null,
      cliente: clienteId ? { id: clienteId, nombre: clientes.get(clienteId)?.nombre ?? "(sin nombre)" } : null,
      tarea: h.tarea,
      desde: formatTime(h.desde),
      hasta: formatTime(h.hasta),
      horas: h.horas,
      facturable: h.facturable,
      mesAFacturar: h.mesAFacturar,
      cargadoPor: ref(h.cargadoPor),
    };
  });
  return { ok: true, data: { range: resolved.range, records, total: sumHours(records.map((r) => r.horas)) } };
}

/** Colaborador: Activo (o el que ya tenía el registro) y que exista en Usuarios. */
async function colaboradorOk(id: string, keep: string | null): Promise<boolean> {
  const user = await getAirtableClient().get(TABLES.usuarios.id, id, { fields: [U.estado] });
  return !!user && (user.fields[U.estado] === "Activo" || id === keep);
}

/** Proyecto: cualquiera (también Cerrado) que exista en Proyectos. */
async function proyectoOk(id: string): Promise<boolean> {
  return !!(await getAirtableClient().get(TABLES.proyectos.id, id, { fields: [P.estado] }));
}

export interface Actor {
  id: string;
}

export async function createHora(actor: Actor, raw: RawValues): Promise<ServiceResult<{ id: string }>> {
  const { values, errors } = validateHora(raw, "admin");
  if (!values) return fail(400, HORA_MESSAGES.validacion, errors);
  const refErrors: Record<string, string> = {};
  if (!(await colaboradorOk(values.colaborador!, null))) refErrors.colaborador = HORA_ADMIN_MESSAGES.colaboradorInactivo;
  if (!(await proyectoOk(values.proyecto))) refErrors.proyecto = HORA_ADMIN_MESSAGES.proyectoInexistente;
  if (Object.keys(refErrors).length > 0) return fail(400, HORA_MESSAGES.validacion, refErrors);

  const slot = { colaborador: values.colaborador!, fecha: values.fecha, desde: values.desde, hasta: values.hasta };
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
    colaborador: values.colaborador,
    cargadoPor: actor.id,
    facturable: values.facturable ?? true,
    ...(values.mesAFacturar ? { mesAFacturar: values.mesAFacturar } : {}),
  });
  return writeHora({ mode: "create" }, fields, slot);
}

/** Edición. Cargado por no cambia nunca. */
export async function updateHora(_actor: Actor, id: string, raw: RawValues): Promise<ServiceResult<{ id: string }>> {
  if (!RECORD_ID_RE.test(id)) return fail(404, HORA_MESSAGES.noEncontrado);
  const existing = await getHora(id);
  if (!existing) return fail(404, HORA_MESSAGES.noEncontrado);

  const { values, errors } = validateHora(raw, "admin");
  if (!values) return fail(400, HORA_MESSAGES.validacion, errors);
  const refErrors: Record<string, string> = {};
  if (!(await colaboradorOk(values.colaborador!, existing.colaborador))) refErrors.colaborador = HORA_ADMIN_MESSAGES.colaboradorInactivo;
  if (values.proyecto !== existing.proyecto && !(await proyectoOk(values.proyecto))) refErrors.proyecto = HORA_ADMIN_MESSAGES.proyectoInexistente;
  if (Object.keys(refErrors).length > 0) return fail(400, HORA_MESSAGES.validacion, refErrors);

  const slot = { colaborador: values.colaborador!, fecha: values.fecha, desde: values.desde, hasta: values.hasta };
  const overlaps = await findOverlaps(slot, id);
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
    colaborador: values.colaborador,
    facturable: values.facturable,
    mesAFacturar: values.mesAFacturar,
  });
  delete fields[H.cargadoPor];
  return writeHora({ mode: "edit", existing }, fields, slot);
}

/** Borrado físico (Horas no tiene referencias). */
export async function deleteHora(id: string): Promise<ServiceResult<{ id: string }>> {
  if (!RECORD_ID_RE.test(id)) return fail(404, HORA_MESSAGES.noEncontrado);
  if (!(await getHora(id))) return fail(404, HORA_MESSAGES.noEncontrado);
  await getAirtableClient().delete(HORAS_TABLE, [id]);
  return { ok: true, data: { id } };
}
