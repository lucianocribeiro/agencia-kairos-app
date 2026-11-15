/**
 * Reporte «Socios» (hoja Socios del Excel). Puro; centavos enteros.
 * Tabla 1: histórica (todas las fechas). Tabla 2: total retirado neto por mes del período.
 */
import { formatNumber } from "@/lib/format";
import { toCents } from "@/lib/ventas-compras/money";
import { indiceMes, type Periodo } from "./periodo";
import { collator, type ComprobanteR, type MovimientoR } from "./types";

/** Tipos de operación por nombre exacto (como en el Excel). */
export const TIPOS_SOCIO = {
  retiro: "Retiro de socio",
  gasto: "Gasto particular de socio",
  aporte: "Aporte de socio",
} as const;

export interface SocioR {
  id: string;
  sigla: string;
  nombre: string;
  /** Decimal (0,5 = 50 %); vacío = 0. */
  porcentaje: number;
}

export interface FilaSocio {
  id: string | null;
  sigla: string;
  nombre: string;
  /** Centavos. */
  retiros: number;
  gastosTesoreria: number;
  gastosCompras: number;
  aportes: number;
  totalNeto: number;
  /** Solo en las filas de socio. */
  porcentaje: number | null;
  leCorresponde: number;
  diferencia: number | null;
  situacion: string | null;
}

export interface FilaSocioMes {
  id: string;
  sigla: string;
  valores: number[];
  total: number;
}

export type SociosData =
  | {
      ok: true;
      periodo: Periodo;
      aviso: string | null;
      socios: FilaSocio[];
      total: FilaSocio;
      porMes: FilaSocioMes[];
    }
  | { ok: false; periodo: Periodo; aviso: string | null; faltan: string[] };

export const SOCIOS_MESSAGES = {
  faltanTipos: (nombres: string[]) =>
    `No encontramos ${nombres.length === 1 ? "el tipo de operación" : "los tipos de operación"} ${nombres.map((n) => `«${n}»`).join(", ")} en Maestros. Sin ${nombres.length === 1 ? "ese tipo" : "esos tipos"} el reporte de Socios no se puede calcular.`,
} as const;

/** |Diferencia| < $ 1 → «Parejo»; si no, «Retiró $ X de más» / «Le falta retirar $ X» (X entero, es-AR). */
export function situacion(diferenciaCents: number): string {
  if (Math.abs(diferenciaCents) < 100) return "Parejo";
  const x = formatNumber(Math.round(Math.abs(diferenciaCents) / 100), { decimals: 0 });
  return diferenciaCents > 0 ? `Retiró $ ${x} de más` : `Le falta retirar $ ${x}`;
}

export function calcularSocios(
  periodo: Periodo,
  socios: readonly SocioR[],
  tipos: readonly { id: string; nombre: string }[],
  compras: readonly ComprobanteR[],
  movimientos: readonly MovimientoR[],
  aviso: string | null = null,
): SociosData {
  const idDe = (nombre: string) => tipos.find((t) => t.nombre === nombre)?.id ?? null;
  const ids = { retiro: idDe(TIPOS_SOCIO.retiro), gasto: idDe(TIPOS_SOCIO.gasto), aporte: idDe(TIPOS_SOCIO.aporte) };
  const faltan = (Object.keys(TIPOS_SOCIO) as (keyof typeof TIPOS_SOCIO)[]).filter((k) => !ids[k]).map((k) => TIPOS_SOCIO[k]);
  if (faltan.length) return { ok: false, periodo, aviso, faltan };

  const orden = [...socios].sort((a, b) => collator.compare(a.sigla, b.sigla));
  const filas: FilaSocio[] = orden.map((s) => {
    const mov = movimientos.filter((m) => m.socio === s.id);
    const sumTipo = (tipo: string | null) => mov.filter((m) => m.tipo === tipo).reduce((n, m) => n + m.cuentaSocio, 0);
    const retiros = sumTipo(ids.retiro);
    const gastosTesoreria = sumTipo(ids.gasto);
    const gastosCompras = compras.filter((c) => c.kind === "compras" && c.socio === s.id).reduce((n, c) => n + c.neto, 0);
    const aportes = -sumTipo(ids.aporte) || 0;
    return {
      id: s.id,
      sigla: s.sigla,
      nombre: s.nombre,
      retiros,
      gastosTesoreria,
      gastosCompras,
      aportes,
      totalNeto: retiros + gastosTesoreria + gastosCompras - aportes || 0,
      porcentaje: s.porcentaje,
      leCorresponde: 0,
      diferencia: null,
      situacion: null,
    };
  });
  const total: FilaSocio = {
    id: null,
    sigla: "Total",
    nombre: "",
    retiros: 0,
    gastosTesoreria: 0,
    gastosCompras: 0,
    aportes: 0,
    totalNeto: 0,
    porcentaje: null,
    leCorresponde: 0,
    diferencia: null,
    situacion: null,
  };
  for (const f of filas) {
    total.retiros += f.retiros;
    total.gastosTesoreria += f.gastosTesoreria;
    total.gastosCompras += f.gastosCompras;
    total.aportes += f.aportes;
    total.totalNeto += f.totalNeto;
  }
  for (const f of filas) {
    f.leCorresponde = toCents((total.totalNeto / 100) * (f.porcentaje ?? 0)) || 0;
    f.diferencia = f.totalNeto - f.leCorresponde || 0;
    f.situacion = situacion(f.diferencia);
    total.leCorresponde += f.leCorresponde;
  }

  const porMes: FilaSocioMes[] = orden.map((s) => {
    const valores = Array<number>(12).fill(0);
    for (const m of movimientos) {
      const i = indiceMes(periodo, m.fecha);
      if (m.socio === s.id && i >= 0) valores[i] += m.cuentaSocio;
    }
    for (const c of compras) {
      const i = indiceMes(periodo, c.mes);
      if (c.kind === "compras" && c.socio === s.id && i >= 0) valores[i] += c.cuentaSocio;
    }
    const limpios = valores.map((v) => v || 0);
    return { id: s.id, sigla: s.sigla, valores: limpios, total: limpios.reduce((a, b) => a + b, 0) };
  });

  return { ok: true, periodo, aviso, socios: filas, total, porMes };
}
