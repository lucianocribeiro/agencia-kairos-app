/**
 * Reglas de un registro de Horas. Client-safe: el formulario valida con las
 * mismas funciones, pero la fuente de verdad es el servidor.
 */
import type { FieldErrors } from "@/lib/abm/fields";
import { isIsoDate, mesAFacturarToStorage } from "./dates";
import { formatTime, parseTime } from "./time";

export const TAREA_MAX = 1000;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;

export const HORA_MESSAGES = {
  fecha: "Ingresá una fecha válida.",
  proyecto: "Elegí un proyecto.",
  colaborador: "Elegí un colaborador.",
  tarea: "Contá en qué trabajaste.",
  tareaLarga: `La tarea no puede superar los ${TAREA_MAX} caracteres.`,
  hora: "Ingresá una hora válida (HH:mm, de 00:00 a 23:59).",
  rango: "La hora hasta tiene que ser posterior a la hora desde.",
  mes: "Elegí un mes válido.",
  mesRequerido: "Elegí el mes a facturar.",
  futura: "No podés cargar horas en una fecha futura.",
  noAsignado: "No tenés asignado ese proyecto.",
  validacion: "Revisá los campos marcados.",
  noEncontrado: "No encontramos el registro. Puede que lo hayan borrado.",
  superposicion: (rangos: string[]) => `Ese horario se superpone con otro registro del mismo día (${rangos.join(", ")}).`,
} as const;

/** Claves que acepta cada API (allowlist de toRawValues). */
export const HORA_INPUT_KEYS = {
  empleado: ["fecha", "proyecto", "tarea", "desde", "hasta"],
  // Sin «estadoFacturacion» (CC-F4-10 / F4-12): cargar horas y facturar son cosas separadas; el
  // estado solo cambia desde la selección (POST /api/admin/horas/seleccion/estado).
  admin: ["fecha", "proyecto", "tarea", "desde", "hasta", "colaborador", "facturable", "mesAFacturar"],
} as const;

export interface HoraValues {
  fecha: string;
  proyecto: string;
  tarea: string;
  desde: number;
  hasta: number;
  /** Solo Admin. */
  colaborador?: string;
  /** Solo Admin. undefined = no vino (alta: true por defecto). */
  facturable?: boolean;
  /** Solo Admin. "YYYY-MM-01"; undefined = no vino (edición: queda el guardado). Nunca vacío. */
  mesAFacturar?: string;
}

/** Un link de un formulario: "rec…" o ["rec…"] → "rec…". */
function singleId(value: unknown): string | null {
  const v = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value;
  return typeof v === "string" && RECORD_ID_RE.test(v.trim()) ? v.trim() : null;
}

/** Mes a facturar por defecto: el mes de la Fecha, "YYYY-MM-01" (null si la fecha no es válida). */
export function mesDeFecha(fecha: string): string | null {
  return isIsoDate(fecha) ? `${fecha.slice(0, 7)}-01` : null;
}

/** Selects de Mes a facturar (formulario de Admin). */
export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"] as const;
/** Años del select: 2000–2099, el mismo rango que los reportes y la Proforma. */
export const ANIO_MES_MIN = 2000;
export const ANIO_MES_MAX = 2099;

/** "YYYY-MM" → { anio: "YYYY", mes: "MM" }; "" → los dos vacíos. */
export function partesMes(value: string): { anio: string; mes: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  return m ? { anio: m[1], mes: m[2] } : { anio: "", mes: "" };
}

/** { anio, mes } → "YYYY-MM"; "" si falta alguno (el guardado pide el mes a facturar). */
export function unirMes(anio: string, mes: string): string {
  return anio && mes ? `${anio}-${mes}` : "";
}

/** Opciones del select de Año: 2000–2099, más el año guardado si quedó fuera (legacy). */
export function aniosMesAFacturar(actual: string): string[] {
  const out = Array.from({ length: ANIO_MES_MAX - ANIO_MES_MIN + 1 }, (_, i) => String(ANIO_MES_MIN + i));
  return /^\d{4}$/.test(actual) && !out.includes(actual) ? [actual, ...out].sort() : out;
}

/**
 * Formulario de Admin: valor inicial del Mes a facturar ("YYYY-MM"; los selects lo parten con `partesMes`).
 * Edición: el guardado; si está vacío (legacy), el mes de la Fecha. Alta: el mes de la Fecha.
 */
export function mesFormInicial(guardado: string | null, fecha: string): string {
  return (guardado ?? mesDeFecha(fecha) ?? "").slice(0, 7);
}

/**
 * Formulario de Admin: Mes a facturar después de cambiar la Fecha. Solo sigue a la Fecha
 * en el alta y mientras el Admin no lo cambió a mano (`sigueFecha`); si no, queda igual.
 */
export function mesFormAlCambiarFecha(mes: string, fecha: string, sigueFecha: boolean): string {
  return sigueFecha && isIsoDate(fecha) ? fecha.slice(0, 7) : mes;
}

/**
 * Valida y normaliza. `role: "admin"` además pide Colaborador y acepta
 * Facturable y Mes a facturar. Las claves que no correspondan al rol se ignoran.
 */
export function validateHora(
  raw: Record<string, unknown>,
  role: "empleado" | "admin",
): { values: HoraValues | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const fecha = typeof raw.fecha === "string" ? raw.fecha.trim() : "";
  if (!isIsoDate(fecha)) errors.fecha = HORA_MESSAGES.fecha;

  const proyecto = singleId(raw.proyecto);
  if (!proyecto) errors.proyecto = HORA_MESSAGES.proyecto;

  const tarea = typeof raw.tarea === "string" ? raw.tarea.trim() : "";
  if (!tarea) errors.tarea = HORA_MESSAGES.tarea;
  else if ([...tarea].length > TAREA_MAX) errors.tarea = HORA_MESSAGES.tareaLarga;

  const desde = parseTime(raw.desde);
  const hasta = parseTime(raw.hasta);
  if (desde === null) errors.desde = HORA_MESSAGES.hora;
  if (hasta === null) errors.hasta = HORA_MESSAGES.hora;
  else if (desde !== null && hasta <= desde) errors.hasta = HORA_MESSAGES.rango;

  const values: Partial<HoraValues> = { fecha, proyecto: proyecto ?? "", tarea, desde: desde ?? 0, hasta: hasta ?? 0 };

  if (role === "admin") {
    const colaborador = singleId(raw.colaborador);
    if (!colaborador) errors.colaborador = HORA_MESSAGES.colaborador;
    values.colaborador = colaborador ?? "";
    if (typeof raw.facturable === "boolean") values.facturable = raw.facturable;
    if ("mesAFacturar" in raw) {
      const mes = raw.mesAFacturar;
      if (mes === "" || mes === null || mes === undefined) errors.mesAFacturar = HORA_MESSAGES.mesRequerido;
      else {
        const stored = mesAFacturarToStorage(mes);
        if (!stored) errors.mesAFacturar = HORA_MESSAGES.mes;
        else values.mesAFacturar = stored;
      }
    }
  }

  return Object.keys(errors).length > 0 ? { values: null, errors } : { values: values as HoraValues, errors };
}

// ── Superposición ────────────────────────────────────────────────────────────

export interface TimeRange {
  desde: number;
  hasta: number;
}

/** [a.desde, a.hasta) y [b.desde, b.hasta) se pisan. Rangos que se tocan (10–12 y 12–13) no. */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.desde < b.hasta && b.desde < a.hasta;
}

/** Rangos de `others` que se pisan con `range`, ordenados. */
export function overlapping<T extends TimeRange>(range: TimeRange, others: readonly T[]): T[] {
  return others.filter((o) => rangesOverlap(range, o)).sort((a, b) => a.desde - b.desde);
}

export const formatRange = (r: TimeRange) => `${formatTime(r.desde)}–${formatTime(r.hasta)}`;

export const overlapMessage = (ranges: readonly TimeRange[]) => HORA_MESSAGES.superposicion(ranges.map(formatRange));
