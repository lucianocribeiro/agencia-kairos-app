/**
 * Proforma de horas (hoja «Proforma» del Excel): horas a facturar de un cliente en un
 * mes, con totales por moneda. Puro y client-safe. Horas con `recordHours`/`sumHours`
 * (lib/horas/time.ts); importes en centavos enteros con `toCents` (ROUND de Excel).
 */
import { formatCuit } from "@/lib/cuit";
import { formatNumber } from "@/lib/format";
import { recordHours, sumHours } from "@/lib/horas/time";
import { toCents } from "@/lib/ventas-compras/money";
import type { ConversionTC } from "./tipo-cambio";

/** Parámetro (Concepto) con la alícuota de IVA de la proforma. */
export const PARAM_ALICUOTA = "Alícuota IVA (proforma de horas)";

export const PROFORMA_MESSAGES = {
  mes: "Elegí un mes válido (AAAA-MM).",
  cliente: "Elegí un cliente.",
  clienteInexistente: "No encontramos ese cliente. Puede que lo hayan borrado.",
  clienteInactivo: "El cliente no está Activo. Elegí un cliente Activo.",
  alicuota: "Revisá el parámetro Alícuota IVA (proforma de horas) en Maestros.",
  faltaValorHora: "Falta valor hora o moneda en el proyecto",
  incompleta: "La proforma está incompleta: hay proyectos sin valor hora o moneda (no suman en los totales).",
  vacia: (mesLabel: string) => `No hay horas facturables de este cliente en ${mesLabel}.`,
} as const;

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Mes a facturar: "AAAA-MM" entre 2000-01 y 2099-12. */
export const isMesProforma = (v: unknown): v is string => typeof v === "string" && MES_RE.test(v) && v >= "2000-01" && v <= "2099-12";

/** "2026-11" → "11/2026". */
export const mesLabel = (mes: string) => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;

/**
 * Alícuota del Parámetro (texto) → tasa entre 0 y 1. Acepta decimal con punto o coma
 * («0.21», «0,21») o porcentaje («21%», «21 %», «21»). Un número ≤ 1 sin «%» es una tasa;
 * entre 1 y 100, un porcentaje. Vacío, negativo, > 100 % o mal formado → null.
 */
export function parseAlicuota(valor: unknown): number | null {
  const s = typeof valor === "string" ? valor.trim() : typeof valor === "number" ? String(valor) : "";
  const m = /^(\d{1,3}(?:[.,]\d{1,6})?)\s*(%?)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const rate = m[2] === "%" || n > 1 ? n / 100 : n;
  return rate >= 0 && rate <= 1 ? Math.round(rate * 1e8) / 1e8 : null;
}

export type Moneda = "ARS" | "USD";

export interface ClienteP {
  id: string;
  nombre: string;
  sigla: string;
  cuit: string | null;
  condicionIva: string | null;
}

export interface ProyectoP {
  id: string;
  codigo: string;
  cliente: string | null;
  /** Valor hora actual del proyecto (vacío = null). */
  valorHora: number | null;
  moneda: Moneda | null;
}

export interface HoraP {
  id: string;
  /** "AAAA-MM-DD" */
  fecha: string | null;
  colaborador: string | null;
  proyecto: string | null;
  tarea: string;
  /** Segundos desde las 00:00. */
  desde: number | null;
  hasta: number | null;
  facturable: boolean;
  /** "AAAA-MM-DD" (siempre el día 1) o null. */
  mesAFacturar: string | null;
}

export interface FilaProyectoP {
  id: string;
  codigo: string;
  horas: number;
  valorHora: number | null;
  moneda: Moneda | null;
  /** Centavos: Σ importes de los registros; null si falta valor hora o moneda. */
  importe: number | null;
  aviso: string | null;
}

export interface TotalMoneda {
  moneda: Moneda;
  /** Centavos. */
  subtotal: number;
  iva: number;
  total: number;
}

export interface FilaDetalleP {
  id: string;
  fecha: string;
  colaborador: string;
  /** Código del proyecto. */
  proyecto: string;
  proyectoId: string;
  tarea: string;
  horas: number;
  valorHora: number | null;
  moneda: Moneda | null;
  /** Centavos; null si falta valor hora o moneda. */
  importe: number | null;
  /** Para ordenar. */
  desde: number | null;
}

export interface ProformaData {
  cliente: { id: string; nombre: string; sigla: string; cuit: string; condicionIva: string };
  /** "AAAA-MM" y «mm/aaaa». */
  mes: string;
  mesLabel: string;
  /** Tasa (0,21) y etiqueta «IVA 21 %». */
  alicuota: number;
  alicuotaLabel: string;
  proyectos: FilaProyectoP[];
  totales: TotalMoneda[];
  detalle: FilaDetalleP[];
  /** Hay proyectos sin valor hora o moneda. */
  incompleta: boolean;
  /** No hay registros que cuenten. */
  vacia: boolean;
  /**
   * Equivalente en pesos con el TC del Admin (CC-F5-21), solo si hay totales en USD y un TC válido
   * (`aplicarTipoCambio`, lib/proforma/tipo-cambio.ts). Ausente = la proforma de siempre.
   */
  conversion?: ConversionTC;
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/**
 * Reglas de importes de la proforma, compartidas con la vista Cliente (lib/cliente):
 * - importe de un registro = round2(horas × valor hora), en centavos;
 * - el importe de un proyecto (o de un colaborador) es la SUMA de los importes de sus registros;
 * - por moneda: subtotal = Σ importes; IVA = round2(subtotal × alícuota); total = subtotal + IVA.
 * Nunca se suman monedas distintas.
 */
export const importeRegistro = (horas: number, valorHora: number): number => toCents(horas * valorHora) || 0;

/** IVA (centavos) de un neto en centavos. */
export const ivaDe = (subtotal: number, alicuota: number): number => toCents((subtotal / 100) * alicuota) || 0;

/** Totales por moneda (ARS, después USD) de los importes con moneda; los null no suman. */
export function totalesPorMoneda(items: readonly { moneda: Moneda | null; importe: number | null }[], alicuota: number): TotalMoneda[] {
  return (["ARS", "USD"] as const)
    .map((moneda) => {
      const filas = items.filter((p) => p.moneda === moneda && p.importe !== null);
      if (!filas.length) return null;
      const subtotal = filas.reduce((n, p) => n + p.importe!, 0);
      const iva = ivaDe(subtotal, alicuota);
      return { moneda, subtotal, iva, total: subtotal + iva };
    })
    .filter((t): t is TotalMoneda => t !== null);
}

/** Mes a facturar efectivo: el guardado; si no, el mes de la Fecha. "AAAA-MM" o null. */
export const mesEfectivo = (h: Pick<HoraP, "mesAFacturar" | "fecha">): string | null => (h.mesAFacturar ?? h.fecha)?.slice(0, 7) ?? null;

export function calcularProforma(input: {
  cliente: ClienteP;
  mes: string;
  alicuota: number;
  proyectos: readonly ProyectoP[];
  horas: readonly HoraP[];
  /** ID de usuario → Nombre. */
  colaboradores: ReadonlyMap<string, string>;
}): ProformaData {
  const { cliente, mes, alicuota } = input;
  const delCliente = new Map(input.proyectos.filter((p) => p.cliente === cliente.id).map((p) => [p.id, p]));
  const cuentan = input.horas.filter((h) => h.facturable && h.proyecto !== null && delCliente.has(h.proyecto) && mesEfectivo(h) === mes);

  const detalle: FilaDetalleP[] = cuentan
    .map((h) => {
      const p = delCliente.get(h.proyecto!)!;
      const horas = recordHours(h.desde, h.hasta);
      const conValor = p.valorHora !== null && p.moneda !== null;
      return {
        id: h.id,
        fecha: h.fecha ?? "",
        colaborador: (h.colaborador && input.colaboradores.get(h.colaborador)) || "",
        proyecto: p.codigo,
        proyectoId: p.id,
        tarea: h.tarea,
        horas,
        valorHora: p.valorHora,
        moneda: p.moneda,
        importe: conValor ? importeRegistro(horas, p.valorHora!) : null,
        desde: h.desde,
      };
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.desde ?? 0) - (b.desde ?? 0) || a.id.localeCompare(b.id));

  const porProyecto = new Map<string, FilaDetalleP[]>();
  for (const d of detalle) porProyecto.set(d.proyectoId, [...(porProyecto.get(d.proyectoId) ?? []), d]);
  const proyectos: FilaProyectoP[] = [...porProyecto.entries()]
    .map(([id, filas]) => {
      const p = delCliente.get(id)!;
      const conValor = p.valorHora !== null && p.moneda !== null;
      return {
        id,
        codigo: p.codigo,
        horas: sumHours(filas.map((f) => f.horas)),
        valorHora: p.valorHora,
        moneda: p.moneda,
        importe: conValor ? filas.reduce((n, f) => n + (f.importe ?? 0), 0) : null,
        aviso: conValor ? null : PROFORMA_MESSAGES.faltaValorHora,
      };
    })
    .sort((a, b) => collator.compare(a.codigo, b.codigo));

  const totales = totalesPorMoneda(proyectos, alicuota);

  return {
    cliente: {
      id: cliente.id,
      nombre: cliente.nombre,
      sigla: cliente.sigla,
      cuit: cliente.cuit ? formatCuit(cliente.cuit) || cliente.cuit : "—",
      condicionIva: cliente.condicionIva || "—",
    },
    mes,
    mesLabel: mesLabel(mes),
    alicuota,
    alicuotaLabel: `IVA ${formatNumber(alicuota * 100, { maxDecimals: 2 })} %`,
    proyectos,
    totales,
    detalle,
    incompleta: proyectos.some((p) => p.aviso !== null),
    vacia: detalle.length === 0,
  };
}
