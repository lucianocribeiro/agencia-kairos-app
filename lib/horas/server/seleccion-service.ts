import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { or, recordIdIs } from "@/lib/airtable/formula";
import { TABLES } from "@/lib/airtable/schema";
import type { ServiceResult } from "@/lib/abm/types";
import { PARAM_ALICUOTA, parseAlicuota, PROFORMA_MESSAGES, type HoraP, type Moneda } from "@/lib/proforma/proforma";
import { HORA_FIELDS, PROYECTO_FIELDS } from "@/lib/proforma/server/service";
import { vistaToSheet } from "@/lib/reportes/excel";
import { writeXlsx } from "@/lib/xlsx/write";
import { calcularSeleccion, nombreArchivoSeleccion, SELECCION_MAX, SELECCION_MESSAGES, vistaSeleccion, type SeleccionData } from "../seleccion";

/**
 * Selección de horas (Admin, CC-F4-05). Recibe solo IDs de Horas: todo lo demás (horas,
 * proyecto, valor hora, moneda, alícuota) se relee de Airtable en cada request. Solo lee.
 */

const H = TABLES.horas.fields;
const P = TABLES.proyectos.fields;
const PA = TABLES.parametros.fields;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
/** IDs por lectura (la fórmula OR(RECORD_ID() = …) no crece sin límite). */
const LOTE = 100;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const first = (v: unknown): string | null => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const moneda = (x: unknown): Moneda | null => (x === "ARS" || x === "USD" ? x : null);
const fail = (status: 400 | 409, error: string): ServiceResult<never> => ({ ok: false, status, error });

/** Body `{ ids: string[] }` → IDs únicos, o el error (400). */
export function idsDeSeleccion(body: Record<string, unknown>): { ids: string[] } | { error: string } {
  const raw = body.ids;
  if (!Array.isArray(raw) || raw.length === 0) return { error: SELECCION_MESSAGES.vacia };
  if (raw.length > SELECCION_MAX) return { error: SELECCION_MESSAGES.maximo };
  if (!raw.every((id) => typeof id === "string" && RECORD_ID_RE.test(id))) return { error: SELECCION_MESSAGES.inexistentes };
  return { ids: [...new Set(raw as string[])] };
}

export async function cargarSeleccion(body: Record<string, unknown>): Promise<ServiceResult<SeleccionData>> {
  const v = idsDeSeleccion(body);
  if ("error" in v) return fail(400, v.error);
  const client = getAirtableClient();
  const lotes = Array.from({ length: Math.ceil(v.ids.length / LOTE) }, (_, i) => v.ids.slice(i * LOTE, (i + 1) * LOTE));
  const leidas = (await Promise.all(lotes.map((ids) => client.list(TABLES.horas.id, { fields: HORA_FIELDS, filterByFormula: or(...ids.map(recordIdIs)) })))).flat();
  // La fórmula filtra en Airtable; se vuelve a filtrar acá por el ID exacto.
  const pedidos = new Set(v.ids);
  const porId = new Map(leidas.filter((r) => pedidos.has(r.id)).map((r) => [r.id, r]));
  if (porId.size !== pedidos.size) return fail(400, SELECCION_MESSAGES.inexistentes);

  const horas: HoraP[] = [...porId.values()].map((r) => ({
    id: r.id,
    fecha: typeof r.fields[H.fecha] === "string" ? (r.fields[H.fecha] as string) : null,
    colaborador: first(r.fields[H.colaborador]),
    proyecto: first(r.fields[H.proyecto]),
    tarea: text(r.fields[H.tarea]),
    desde: num(r.fields[H.horaDesde]),
    hasta: num(r.fields[H.horaHasta]),
    facturable: r.fields[H.facturable] === true,
    mesAFacturar: typeof r.fields[H.mesAFacturar] === "string" ? (r.fields[H.mesAFacturar] as string) : null,
  }));
  if (horas.some((h) => !h.proyecto)) return fail(400, SELECCION_MESSAGES.sinProyecto);
  if (new Set(horas.map((h) => h.proyecto)).size > 1) return fail(400, SELECCION_MESSAGES.variosProyectos);
  if (horas.some((h) => !h.facturable)) return fail(400, SELECCION_MESSAGES.noFacturables);

  const proyectoId = horas[0].proyecto!;
  const [proyecto, parametros, usuarios] = await Promise.all([
    client.get(TABLES.proyectos.id, proyectoId, { fields: PROYECTO_FIELDS }),
    client.list(TABLES.parametros.id, { fields: [PA.concepto, PA.valor] }),
    client.list(TABLES.usuarios.id, { fields: [TABLES.usuarios.fields.nombre] }),
  ]);
  if (!proyecto) return fail(400, SELECCION_MESSAGES.inexistentes);
  const alicuota = parseAlicuota(parametros.find((r) => text(r.fields[PA.concepto]) === PARAM_ALICUOTA)?.fields[PA.valor]);
  if (alicuota === null) return fail(409, PROFORMA_MESSAGES.alicuota);

  return {
    ok: true,
    data: calcularSeleccion({
      proyecto: {
        id: proyecto.id,
        codigo: text(proyecto.fields[P.codigo]) || "(sin código)",
        cliente: first(proyecto.fields[P.cliente]),
        valorHora: num(proyecto.fields[P.valorHora]),
        moneda: moneda(proyecto.fields[P.monedaValorHora]),
      },
      alicuota,
      horas,
      colaboradores: new Map(usuarios.map((r) => [r.id, text(r.fields[TABLES.usuarios.fields.nombre])])),
    }),
  };
}

/** La misma vista que la pantalla, como .xlsx. */
export function seleccionXlsx(d: SeleccionData): { bytes: Buffer; filename: string } {
  return { bytes: writeXlsx(vistaToSheet(vistaSeleccion(d), "Selección")), filename: nombreArchivoSeleccion(d) };
}
