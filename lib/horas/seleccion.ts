/**
 * Selección de horas (Admin › Horas, CC-F4-05): horas Facturables de UN proyecto
 * elegidas a mano → importe a facturar con las reglas de la Proforma
 * (`importeRegistro`, `totalesPorMoneda` de lib/proforma/proforma.ts; horas con
 * `recordHours`/`sumHours`). Pantalla y Excel salen de la misma vista (`vistaSeleccion`).
 * Puro y client-safe. No guarda nada.
 */
import { codigoParaArchivo } from "@/lib/cliente/vista";
import { importeRegistro, totalesPorMoneda, type HoraP, type Moneda, type ProyectoP } from "@/lib/proforma/proforma";
import type { Vista, VistaFila } from "@/lib/reportes/vista";
import { toCents } from "@/lib/ventas-compras/money";
import { displayDate } from "./dates";
import { recordHours, sumHours } from "./time";

export const SELECCION_MAX = 500;

export const SELECCION_MESSAGES = {
  vacia: "Seleccioná al menos un registro.",
  maximo: `Seleccioná hasta ${SELECCION_MAX} registros.`,
  inexistentes: "Algunas horas ya no existen. Actualizá la lista.",
  variosProyectos: "La selección tiene horas de más de un proyecto.",
  noFacturables: "La selección incluye horas no facturables.",
  sinProyecto: "La selección incluye horas sin proyecto.",
  unProyecto: "Sólo podés seleccionar horas de un mismo proyecto.",
  noDisponible: "Importe no disponible",
} as const;

export interface FilaSeleccion {
  id: string;
  /** "AAAA-MM-DD" */
  fecha: string;
  colaborador: string;
  tarea: string;
  horas: number;
  /** Centavos: round2(horas × valor hora); null si el proyecto no tiene valor hora o moneda. */
  importe: number | null;
}

export interface SeleccionData {
  proyecto: { id: string; codigo: string };
  valorHora: number | null;
  moneda: Moneda | null;
  registros: number;
  horas: number;
  /** Centavos; null = «Importe no disponible». */
  neto: number | null;
  iva: number | null;
  total: number | null;
  /** Fechas mínima y máxima de la selección ("AAAA-MM-DD"). */
  desde: string;
  hasta: string;
  /** Ordenado por Fecha (y Desde). */
  detalle: FilaSeleccion[];
}

/**
 * Las horas ya vienen validadas (existen, Facturables, todas de `proyecto`). Mismas
 * cuentas que la Proforma: importe por registro y neto = Σ importes; IVA y total por moneda.
 */
export function calcularSeleccion(input: {
  proyecto: ProyectoP;
  alicuota: number;
  horas: readonly HoraP[];
  colaboradores: ReadonlyMap<string, string>;
}): SeleccionData {
  const { proyecto: p, alicuota } = input;
  const conValor = p.valorHora !== null && p.moneda !== null;
  const ordenadas = [...input.horas].sort(
    (a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? "") || (a.desde ?? 0) - (b.desde ?? 0) || a.id.localeCompare(b.id),
  );
  const detalle: FilaSeleccion[] = ordenadas.map((h) => {
    const horas = recordHours(h.desde, h.hasta);
    return {
      id: h.id,
      fecha: h.fecha ?? "",
      colaborador: (h.colaborador && input.colaboradores.get(h.colaborador)) || "",
      tarea: h.tarea,
      horas,
      importe: conValor ? importeRegistro(horas, p.valorHora!) : null,
    };
  });
  const [tot] = conValor ? totalesPorMoneda(detalle.map((d) => ({ moneda: p.moneda, importe: d.importe })), alicuota) : [];
  const fechas = detalle.map((d) => d.fecha).filter(Boolean);
  return {
    proyecto: { id: p.id, codigo: p.codigo },
    valorHora: p.valorHora,
    moneda: p.moneda,
    registros: detalle.length,
    horas: sumHours(detalle.map((d) => d.horas)),
    neto: tot ? tot.subtotal : null,
    iva: tot ? tot.iva : null,
    total: tot ? tot.total : null,
    desde: fechas[0] ?? "",
    hasta: fechas.at(-1) ?? "",
    detalle,
  };
}

export const SELECCION_TITULO = "Selección de horas";

/** Lo que se ve y lo que se descarga: proyecto, detalle por registro y totales. */
export function vistaSeleccion(d: SeleccionData): Vista {
  const nd = SELECCION_MESSAGES.noDisponible;
  const sinImporte = d.neto === null;
  return {
    titulo: SELECCION_TITULO,
    lineas: [`Período: ${displayDate(d.desde)} al ${displayDate(d.hasta)}`],
    avisos: [],
    error: null,
    tablas: [
      {
        titulo: "Proyecto",
        columnas: [
          { label: "Proyecto", kind: "text" },
          { label: "Valor hora", kind: "money" },
          { label: "Moneda", kind: "text" },
        ],
        filas: [{ cells: [d.proyecto.codigo, d.valorHora === null ? null : toCents(d.valorHora), d.moneda] }],
      },
      {
        titulo: "Detalle",
        columnas: [
          { label: "Fecha", kind: "text" },
          { label: "Colaborador", kind: "text" },
          { label: "Tarea", kind: "text" },
          { label: "Horas", kind: "hours" },
          { label: "Importe", kind: "money" },
        ],
        filas: d.detalle.map((f): VistaFila => ({ cells: [displayDate(f.fecha), f.colaborador, f.tarea, f.horas, f.importe ?? nd] })),
      },
      {
        titulo: "Totales",
        columnas: [
          { label: "Horas", kind: "hours" },
          { label: "Neto", kind: "money" },
          { label: "IVA", kind: "money" },
          { label: "Total", kind: "money" },
        ],
        filas: [{ cells: [d.horas, sinImporte ? nd : d.neto, d.iva, d.total], total: true }],
      },
    ],
  };
}

/** «Seleccion_<Código>_<AAAA-MM-DD>_<AAAA-MM-DD>.xlsx» (Código sanitizado como en la vista Cliente). */
export function nombreArchivoSeleccion(d: SeleccionData): string {
  return `Seleccion_${codigoParaArchivo(d.proyecto.codigo) || "Proyecto"}_${d.desde}_${d.hasta}.xlsx`;
}

/**
 * ¿Se puede tildar esta fila? null = sí; si no, el motivo (tooltip). Solo Facturables con
 * proyecto y, si ya hay algo elegido, del mismo proyecto.
 */
export function motivoNoSeleccionable(r: { facturable: boolean; proyecto: { id: string } | null }, proyectoElegido: string | null): string | null {
  if (!r.facturable) return "Sólo se pueden seleccionar horas facturables.";
  if (!r.proyecto) return SELECCION_MESSAGES.sinProyecto;
  if (proyectoElegido && r.proyecto.id !== proyectoElegido) return SELECCION_MESSAGES.unProyecto;
  return null;
}
