import "server-only";

import { getAirtableClient, type Fields } from "@/lib/airtable/client";
import { and, field, formula } from "@/lib/airtable/formula";
import { invalidFieldIds } from "@/lib/airtable/payload";
import { TABLES } from "@/lib/airtable/schema";
import type { RawValues } from "@/lib/abm/fields";
import type { ServiceResult } from "@/lib/abm/types";
import { addDays, shortcutRange, todayInBuenosAires, type DateRange } from "@/lib/horas/dates";
import { resolveRange } from "@/lib/horas/server/write";
import { COLUMNS, type Kind } from "../columns";
import {
  aFila,
  CONTROL_FILTROS,
  evaluarComprobante,
  filtrar,
  ordenar,
  SIN_PROYECTO,
  totalizar,
  type ComprobanteGuardado,
  type FiltrosListado,
  type FilaListado,
  type RefsListado,
  type Totales,
} from "../listado";
import { evaluar } from "../rules";
import { EDICION_KEYS, type Contexto, type Dato, type Ediciones, type Ref } from "../types";
import { loadImportContext } from "./context";
import { validarEdicion } from "./service";

/**
 * Listas, edición y borrado de comprobantes de Ventas y Compras (Admin). Los
 * importes y valores efectivos se calculan en código (lib/ventas-compras/listado.ts),
 * nunca se leen de las fórmulas de Airtable.
 */

export const PAGE_SIZE = 50;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const COMPROBANTE_MESSAGES = {
  noEncontrado: "No encontramos el comprobante. Puede que lo hayan borrado.",
  filtro: "El filtro no es válido.",
  validacion: (motivo: string) => `Revisá los datos: ${motivo}`,
  formato: "Los datos no tienen el formato esperado.",
  error: "Ocurrió un error. Probá de nuevo.",
} as const;

/** Claves que acepta la edición (allowlist de toRawValues). Ventas no tiene socio. */
export const COMPROBANTE_INPUT_KEYS: Record<Kind, readonly string[]> = {
  ventas: EDICION_KEYS.filter((k) => k !== "socio"),
  compras: EDICION_KEYS,
};

const fail = (status: 400 | 404 | 500, error: string): ServiceResult<never> => ({ ok: false, status, error });
const first = (v: unknown): string | null => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);

function readFieldIds(kind: Kind): string[] {
  const F = TABLES[kind].fields as Record<string, string>;
  const extra = ["claveArca", "tipoComprobante", "mesDevengado", "proyecto", "unidadNegocio", "categoria", "observaciones", ...(kind === "compras" ? ["socio", "proveedor"] : [])];
  return [...new Set([...COLUMNS[kind].map((c) => F[c.key]), ...extra.map((k) => F[k])])];
}

/** Registro de Airtable (por ID de campo) → ComprobanteGuardado (por clave). */
export function toGuardado(kind: Kind, rec: { id: string; fields: Fields }): ComprobanteGuardado {
  const F = TABLES[kind].fields as Record<string, string>;
  const f = rec.fields;
  const datos: Record<string, Dato> = {};
  for (const col of COLUMNS[kind]) {
    const v = f[F[col.key]];
    datos[col.key] = typeof v === "number" || typeof v === "string" ? v : null;
  }
  return {
    id: rec.id,
    clave: typeof f[F.claveArca] === "string" ? (f[F.claveArca] as string) : "",
    datos,
    tipoComprobanteId: first(f[F.tipoComprobante]),
    mesDevengado: typeof f[F.mesDevengado] === "string" ? (f[F.mesDevengado] as string) : null,
    proyecto: first(f[F.proyecto]),
    unidadNegocio: first(f[F.unidadNegocio]),
    categoria: first(f[F.categoria]),
    socio: kind === "compras" ? first(f[F.socio]) : null,
    observaciones: typeof f[F.observaciones] === "string" ? (f[F.observaciones] as string) : "",
    proveedor: kind === "compras" ? first(f[F.proveedor]) : null,
  };
}

/** Fecha dentro de [desde, hasta]: AND({fecha}, IS_AFTER(…, desde − 1), IS_BEFORE(…, hasta + 1)). Se vuelve a filtrar en código. */
function fechaFormula(kind: Kind, range: DateRange) {
  const f = field(TABLES[kind].fields.fecha);
  return and(f, formula`IS_AFTER(${f}, ${addDays(range.desde, -1)})`, formula`IS_BEFORE(${f}, ${addDays(range.hasta, 1)})`);
}

export interface ListadoQuery extends FiltrosListado {
  desde?: string | null;
  hasta?: string | null;
  pagina?: number | null;
}

export interface ListadoData {
  range: DateRange;
  filas: FilaListado[];
  /** Cantidad de filas del conjunto filtrado (no solo la página). */
  cantidad: number;
  pagina: number;
  paginas: number;
  /** Totales del conjunto filtrado completo (centavos). */
  totales: Totales;
  opciones: {
    contrapartes: Ref[];
    contexto: Contexto;
  };
}

interface Loaded {
  ctx: Contexto;
  refs: RefsListado;
  contrapartes: Ref[];
}

async function loadRefs(kind: Kind): Promise<Loaded> {
  const loaded = await loadImportContext(kind, { claves: false });
  return {
    ctx: loaded.ctx,
    refs: { tipos: loaded.byId.tipos, clientesPorCuit: loaded.refs.clientesPorCuit, proveedores: loaded.byId.proveedores },
    contrapartes: loaded.contrapartes,
  };
}

/** Valida los filtros de la URL. Sin fechas → año actual (por Fecha). */
function parseQuery(kind: Kind, q: ListadoQuery, now: Date): { range: DateRange; filtros: FiltrosListado; pagina: number } | { error: string } {
  const today = todayInBuenosAires(now);
  const resolved = !q.desde && !q.hasta ? { range: shortcutRange("anioActual", today) } : resolveRange(q.desde ?? null, q.hasta ?? null, today);
  if ("error" in resolved) return resolved;
  for (const m of [q.mesDesde, q.mesHasta]) if (m && !MES_RE.test(m)) return { error: COMPROBANTE_MESSAGES.filtro };
  if (q.mesDesde && q.mesHasta && q.mesDesde > q.mesHasta) return { error: COMPROBANTE_MESSAGES.filtro };
  for (const id of [q.contraparte, q.categoria]) if (id && !RECORD_ID_RE.test(id)) return { error: COMPROBANTE_MESSAGES.filtro };
  if (q.proyecto && q.proyecto !== SIN_PROYECTO && !RECORD_ID_RE.test(q.proyecto)) return { error: COMPROBANTE_MESSAGES.filtro };
  if (q.control && !CONTROL_FILTROS[kind].some((c) => c.value === q.control)) return { error: COMPROBANTE_MESSAGES.filtro };
  const pagina = q.pagina ?? 1;
  if (!Number.isInteger(pagina) || pagina < 1) return { error: COMPROBANTE_MESSAGES.filtro };
  return {
    range: resolved.range,
    filtros: { mesDesde: q.mesDesde, mesHasta: q.mesHasta, contraparte: q.contraparte, proyecto: q.proyecto, categoria: q.categoria, control: q.control },
    pagina,
  };
}

/**
 * Lista filtrada. La Fecha se filtra en Airtable (y otra vez en código); el resto
 * (valores efectivos) en código. Los totales cubren todo el conjunto filtrado.
 */
export async function listComprobantes(kind: Kind, q: ListadoQuery, now = new Date()): Promise<ServiceResult<ListadoData>> {
  const parsed = parseQuery(kind, q, now);
  if ("error" in parsed) return fail(400, parsed.error);
  const { range, filtros, pagina } = parsed;
  const [loaded, records] = await Promise.all([
    loadRefs(kind),
    getAirtableClient().list(TABLES[kind].id, { fields: readFieldIds(kind), filterByFormula: fechaFormula(kind, range) }),
  ]);
  const enRango = records
    .map((r) => toGuardado(kind, r))
    .filter((c) => typeof c.datos.fecha === "string" && c.datos.fecha >= range.desde && c.datos.fecha <= range.hasta);
  const filas = ordenar(filtrar(enRango.map((c) => evaluarComprobante(kind, c, loaded.refs, loaded.ctx)), filtros));
  const paginas = Math.max(1, Math.ceil(filas.length / PAGE_SIZE));
  const page = Math.min(pagina, paginas);
  return {
    ok: true,
    data: {
      range,
      filas: filas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      cantidad: filas.length,
      pagina: page,
      paginas,
      totales: totalizar(filas),
      opciones: { contrapartes: loaded.contrapartes, contexto: loaded.ctx },
    },
  };
}

// ── Edición ─────────────────────────────────────────────────────────────────

/**
 * Edita los campos editables (Mes devengado, Proyecto, UN, Categoría, Observaciones;
 * Compras también Imputar a socio). Las claves que no vienen quedan como estaban; ""
 * vacía el campo (vuelve el valor por defecto). Ventas: se recalcula y escribe el link
 * de Cliente con la regla efectiva. Nunca se escriben columnas ARCA ni campos calculados.
 */
export async function updateComprobante(kind: Kind, id: string, raw: RawValues): Promise<ServiceResult<{ id: string; fila: FilaListado }>> {
  if (!RECORD_ID_RE.test(id)) return fail(404, COMPROBANTE_MESSAGES.noEncontrado);
  const F = TABLES[kind].fields as Record<string, string>;
  const record = await getAirtableClient().get(TABLES[kind].id, id, { fields: readFieldIds(kind) });
  if (!record) return fail(404, COMPROBANTE_MESSAGES.noEncontrado);
  const stored = toGuardado(kind, record);

  const ed: Ediciones = {
    mesDevengado: stored.mesDevengado?.slice(0, 7) ?? "",
    proyecto: stored.proyecto ?? "",
    unidadNegocio: stored.unidadNegocio ?? "",
    categoria: stored.categoria ?? "",
    observaciones: stored.observaciones,
    ...(kind === "compras" ? { socio: stored.socio ?? "" } : {}),
  };
  for (const key of COMPROBANTE_INPUT_KEYS[kind]) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (typeof v !== "string") return fail(400, COMPROBANTE_MESSAGES.formato);
    ed[key as keyof Ediciones] = v.trim();
  }

  const loaded = await loadRefs(kind);
  const motivo = validarEdicion(kind, ed, loaded.ctx, stored.proyecto);
  if (motivo) return fail(400, COMPROBANTE_MESSAGES.validacion(motivo));

  const fields: Fields = {
    [F.mesDevengado]: ed.mesDevengado ? `${ed.mesDevengado}-01` : null,
    [F.proyecto]: ed.proyecto ? [ed.proyecto] : [],
    [F.unidadNegocio]: ed.unidadNegocio ? [ed.unidadNegocio] : [],
    [F.categoria]: ed.categoria ? [ed.categoria] : [],
    [F.observaciones]: ed.observaciones ? ed.observaciones : null,
  };
  if (kind === "compras") fields[F.socio] = ed.socio ? [ed.socio] : [];
  const next: ComprobanteGuardado = {
    ...stored,
    mesDevengado: ed.mesDevengado ? `${ed.mesDevengado}-01` : null,
    proyecto: ed.proyecto || null,
    unidadNegocio: ed.unidadNegocio || null,
    categoria: ed.categoria || null,
    socio: kind === "compras" ? ed.socio || null : null,
    observaciones: ed.observaciones ?? "",
  };
  if (kind === "ventas") {
    // Cliente: regla efectiva (proyecto → CUIT → ninguno), recalculada al guardar.
    const { fila, ed: efectivas } = aFila(kind, next, loaded.refs);
    const cliente = evaluar(kind, fila, efectivas, loaded.ctx).cliente;
    fields[F.cliente] = cliente ? [cliente.id] : [];
  }
  const bad = invalidFieldIds(TABLES[kind].id, fields);
  if (bad.length > 0) {
    console.error("[comprobantes] Payload inválido (bug del servidor)", { tabla: kind, campos: bad });
    return fail(500, COMPROBANTE_MESSAGES.error);
  }
  await getAirtableClient().update(TABLES[kind].id, [{ id, fields }], { returnFields: [] });
  return { ok: true, data: { id, fila: evaluarComprobante(kind, next, loaded.refs, loaded.ctx) } };
}

// ── Borrado ─────────────────────────────────────────────────────────────────

/** Borra un comprobante. Un proveedor creado por una importación queda. */
export async function deleteComprobante(kind: Kind, id: string): Promise<ServiceResult<{ id: string }>> {
  if (!RECORD_ID_RE.test(id)) return fail(404, COMPROBANTE_MESSAGES.noEncontrado);
  const record = await getAirtableClient().get(TABLES[kind].id, id, { fields: [TABLES[kind].fields.claveArca] });
  if (!record) return fail(404, COMPROBANTE_MESSAGES.noEncontrado);
  await getAirtableClient().delete(TABLES[kind].id, [id]);
  return { ok: true, data: { id } };
}
