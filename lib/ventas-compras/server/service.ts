import "server-only";

import type { Fields } from "@/lib/airtable/client";
import { findUniqueRaceLosers, losesUniqueRace } from "@/lib/airtable/integrity";
import { invalidFieldIds } from "@/lib/airtable/payload";
import { TABLES } from "@/lib/airtable/schema";
import { Compensation, rollbackAndLog, WRITE_MESSAGES } from "@/lib/abm/server/compensation";
import { injectFault } from "@/lib/abm/server/fault-injection";
import type { ServiceResult } from "@/lib/abm/types";
import { readFirstSheet, XlsxError } from "@/lib/xlsx/read";
import { COLUMNS, type Kind } from "../columns";
import { evaluar, type Evaluacion } from "../rules";
import { buildRows, findHeader, proveedoresNuevos, resumir } from "../rows";
import { EDICION_KEYS, OBSERVACIONES_MAX, type Contexto, type Ediciones, type FilaBase, type Preview, type ResultadoImportacion } from "../types";
import { loadImportContext } from "./context";

/**
 * Importación ARCA (Admin). Sin estado: la vista previa y la confirmación reciben el
 * mismo archivo y lo vuelven a leer; la confirmación recalcula todo en el servidor y
 * solo acepta del cliente las ediciones (validadas). Ver AGENTS.md, «Importación ARCA».
 */

export const IMPORT_MESSAGES = {
  edicionInvalida: (fila: number, motivo: string) => `Revisá la fila ${fila}: ${motivo}`,
  edicionesFormato: "Las ediciones no tienen el formato esperado.",
  proveedorEnParalelo: (nombre: string) =>
    `Otra importación creó al mismo tiempo el proveedor «${nombre}». No se importó nada; probá de nuevo.`,
  error: "Ocurrió un error. Probá de nuevo.",
  ...WRITE_MESSAGES,
} as const;

const fail = (status: 400 | 409 | 500 | 503, error: string): ServiceResult<never> => ({ ok: false, status, error });

type Parsed = { filas: FilaBase[]; ctx: Contexto };

/** Archivo → filas con estado y el contexto de la base. */
async function parse(kind: Kind, file: Uint8Array): Promise<ServiceResult<Parsed>> {
  let sheet;
  try {
    sheet = readFirstSheet(file);
  } catch (err) {
    if (err instanceof XlsxError) return fail(400, err.message);
    throw err;
  }
  const header = findHeader(kind, sheet);
  if ("error" in header) return fail(400, header.error);
  const { refs, ctx } = await loadImportContext(kind);
  const filas = buildRows(kind, sheet, header, refs);
  if ("error" in filas) return fail(400, filas.error);
  return { ok: true, data: { filas, ctx } };
}

export async function previewImport(kind: Kind, file: Uint8Array): Promise<ServiceResult<Preview>> {
  const parsed = await parse(kind, file);
  if (!parsed.ok) return parsed;
  const { filas, ctx } = parsed.data;
  return { ok: true, data: { tipo: kind, filas, contexto: ctx, resumen: resumir(filas), proveedoresNuevos: proveedoresNuevos(filas) } };
}

// ── Ediciones ───────────────────────────────────────────────────────────────

/** Valida las ediciones (por Clave ARCA) contra el contexto. Solo cuentan las filas nuevas. */
export function validarEdiciones(kind: Kind, raw: unknown, filas: readonly FilaBase[], ctx: Contexto): { ediciones: Map<string, Ediciones> } | { error: string } {
  const out = new Map<string, Ediciones>();
  if (raw === undefined || raw === null) return { ediciones: out };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: IMPORT_MESSAGES.edicionesFormato };
  const nuevas = new Map(filas.filter((f) => f.estado === "nueva" && f.clave).map((f) => [f.clave!, f]));
  for (const [clave, value] of Object.entries(raw as Record<string, unknown>)) {
    const fila = nuevas.get(clave);
    if (!fila) continue; // ya importada, duplicada o con error: sus ediciones no se usan
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: IMPORT_MESSAGES.edicionesFormato };
    const ed: Ediciones = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (!(EDICION_KEYS as readonly string[]).includes(key) || typeof v !== "string") return { error: IMPORT_MESSAGES.edicionesFormato };
      ed[key as keyof Ediciones] = v.trim();
    }
    const bad = (motivo: string) => ({ error: IMPORT_MESSAGES.edicionInvalida(fila.fila, motivo) });
    if (ed.mesDevengado && !/^\d{4}-(0[1-9]|1[0-2])$/.test(ed.mesDevengado)) return bad("el mes devengado no es válido.");
    if (ed.proyecto && !ctx.proyectos.some((p) => p.id === ed.proyecto && p.activo)) return bad("elegí un proyecto activo.");
    if (ed.unidadNegocio && !ctx.unidades.some((u) => u.id === ed.unidadNegocio)) return bad("elegí una unidad de negocio válida.");
    const tipoCategoria = kind === "ventas" ? "Ingreso" : "Gasto";
    if (ed.categoria && !ctx.categorias.some((c) => c.id === ed.categoria && c.tipo === tipoCategoria)) {
      return bad(`elegí una categoría de ${kind === "ventas" ? "ingreso" : "gasto"}.`);
    }
    if (ed.socio && (kind !== "compras" || !ctx.socios.some((s) => s.id === ed.socio))) return bad("elegí un socio válido.");
    if (ed.observaciones && [...ed.observaciones].length > OBSERVACIONES_MAX) return bad(`las observaciones superan los ${OBSERVACIONES_MAX} caracteres.`);
    out.set(clave, ed);
  }
  return { ediciones: out };
}

// ── Escritura ───────────────────────────────────────────────────────────────

/**
 * Campos a escribir: columnas ARCA, Tipo comprobante, Clave ARCA, Cliente (Ventas) o
 * Proveedor (Compras), y solo lo que el usuario editó (más, en Compras, la Categoría
 * por defecto del proveedor). Los valores efectivos por defecto no se escriben.
 */
export function camposDeFila(kind: Kind, fila: FilaBase, ed: Ediciones, ev: Evaluacion, proveedorId: string | null): Fields {
  const F = TABLES[kind].fields as Record<string, string>;
  const out: Fields = {};
  for (const col of COLUMNS[kind]) {
    const v = fila.datos[col.key];
    if (v === null || v === "") continue;
    out[F[col.key]] = v;
  }
  out[F.claveArca] = fila.clave;
  out[F.tipoComprobante] = [fila.tipoComprobanteId];
  if (kind === "ventas" && ev.cliente) out[F.cliente] = [ev.cliente.id];
  if (kind === "compras" && proveedorId) out[F.proveedor] = [proveedorId];
  if (ed.mesDevengado) out[F.mesDevengado] = `${ed.mesDevengado}-01`;
  if (ed.proyecto) out[F.proyecto] = [ed.proyecto];
  if (ed.unidadNegocio) out[F.unidadNegocio] = [ed.unidadNegocio];
  if (kind === "ventas" && ed.categoria) out[F.categoria] = [ed.categoria];
  if (kind === "compras" && ev.categoria) out[F.categoria] = [ev.categoria]; // la elegida o la del proveedor
  if (kind === "compras" && ed.socio) out[F.socio] = [ed.socio];
  if (ed.observaciones) out[F.observaciones] = ed.observaciones;
  return out;
}

export async function confirmImport(kind: Kind, file: Uint8Array, edicionesRaw: unknown): Promise<ServiceResult<ResultadoImportacion>> {
  const parsed = await parse(kind, file);
  if (!parsed.ok) return parsed;
  const { filas, ctx } = parsed.data;
  const validated = validarEdiciones(kind, edicionesRaw, filas, ctx);
  if ("error" in validated) return fail(400, validated.error);

  const table = TABLES[kind];
  const P = TABLES.proveedores;
  const nuevas = filas.filter((f) => f.estado === "nueva");
  const resultado: ResultadoImportacion = {
    importadas: 0,
    omitidas: { yaImportadas: filas.filter((f) => f.estado === "ya_importada").length, duplicadasEnArchivo: filas.filter((f) => f.estado === "duplicada").length, enParalelo: 0 },
    conError: filas.filter((f) => f.estado === "error").map((f) => ({ fila: f.fila, motivo: f.error ?? "" })),
    proveedoresCreados: [],
  };
  if (nuevas.length === 0) return { ok: true, data: resultado };

  const provNuevos = kind === "compras" ? proveedoresNuevos(nuevas) : [];
  const provFields: Fields[] = provNuevos.map((p) => ({ [P.fields.nombre]: p.nombre, [P.fields.cuit]: p.cuit }));
  const evaluadas = nuevas.map((f) => {
    const ed = validated.ediciones.get(f.clave!) ?? {};
    return { fila: f, ed, ev: evaluar(kind, f, ed, ctx) };
  });
  // Pre-validación de payloads (sin el ID del proveedor nuevo, que se agrega después).
  const sample = evaluadas.map(({ fila, ed, ev }) => camposDeFila(kind, fila, ed, ev, fila.proveedor?.id ?? null));
  const bad = [...provFields.map((f) => invalidFieldIds(P.id, f)), ...sample.map((f) => invalidFieldIds(table.id, f))].flat();
  if (bad.length > 0) {
    console.error("[importar] Payload inválido (bug del servidor)", { tabla: kind, campos: [...new Set(bad)] });
    return fail(500, IMPORT_MESSAGES.error);
  }

  const tx = new Compensation();
  let proveedorIds: string[] = [];
  let ids: string[];
  try {
    proveedorIds = await tx.createMany(P.id, provFields, (i) => injectFault(`import:proveedores:${i}`));
    const provPorCuit = new Map(provNuevos.map((p, i) => [p.cuit, proveedorIds[i]]));
    const rows = evaluadas.map(({ fila, ed, ev }) => camposDeFila(kind, fila, ed, ev, fila.proveedor?.id ?? (fila.proveedor ? (provPorCuit.get(fila.proveedor.cuit) ?? null) : null)));
    ids = await tx.createMany(table.id, rows, (i) => injectFault(`import:${kind}:${i}`));
  } catch {
    return (await rollbackAndLog(tx, `importar ${kind}`)) ? fail(503, IMPORT_MESSAGES.revertido) : fail(500, IMPORT_MESSAGES.incompleto);
  }

  // Verificación posterior (fail-closed): proveedores (carrera → se deshace todo) y Claves ARCA
  // (las filas propias que pierden contra otra importación se borran y se informan).
  let losers: string[] = [];
  try {
    for (const [i, p] of provNuevos.entries()) {
      if (await losesUniqueRace(P.id, P.fields.cuit, p.cuit, proveedorIds[i], "create")) {
        const undone = await tx.rollback();
        console.error("[importar] Carrera de proveedor", { tabla: kind, id: proveedorIds[i], rollback: undone ? "ok" : "fallido" });
        return undone ? fail(409, IMPORT_MESSAGES.proveedorEnParalelo(p.nombre)) : fail(500, IMPORT_MESSAGES.incompleto);
      }
    }
    losers = await findUniqueRaceLosers(table.id, table.fields.claveArca, ids.map((id, i) => ({ id, value: evaluadas[i].fila.clave })));
    if (losers.length > 0) {
      await tx.discardCreated(table.id, losers);
      console.error("[importar] Claves ARCA importadas en paralelo: se descartan las propias", { tabla: kind, ids: losers });
    }
  } catch {
    const undone = await tx.rollback();
    console.error("[importar] Verificación posterior fallida", { tabla: kind, ids: tx.recordIds, rollback: undone ? "ok" : "fallido" });
    return undone ? fail(503, IMPORT_MESSAGES.noVerificado) : fail(500, IMPORT_MESSAGES.incompleto);
  }

  resultado.importadas = ids.length - losers.length;
  resultado.omitidas.enParalelo = losers.length;
  resultado.proveedoresCreados = provNuevos;
  return { ok: true, data: resultado };
}
