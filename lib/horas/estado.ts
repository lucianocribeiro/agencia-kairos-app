/**
 * Estado de facturación de las horas (CC-F4-08): Pendiente (por defecto), Facturada, Pagada.
 * Client-safe. Un registro sin valor (anterior al campo) es Pendiente en todos lados.
 * Una hora cargada es siempre Pendiente (alta del Admin y del Empleado). Solo el Admin lo cambia, y
 * solo en lote desde la selección (CC-F4-10 / F4-12); el Empleado nunca lo ve.
 */

export const ESTADOS_FACTURACION = ["Pendiente", "Facturada", "Pagada"] as const;
export type EstadoFacturacion = (typeof ESTADOS_FACTURACION)[number];
export const ESTADO_PENDIENTE: EstadoFacturacion = "Pendiente";

export function isEstadoFacturacion(value: unknown): value is EstadoFacturacion {
  return typeof value === "string" && (ESTADOS_FACTURACION as readonly string[]).includes(value);
}

/** Valor guardado → estado efectivo: vacío (o cualquier otra cosa) = Pendiente. */
export function estadoEfectivo(value: unknown): EstadoFacturacion {
  return isEstadoFacturacion(value) ? value : ESTADO_PENDIENTE;
}

/** «facturada(s)», «pagada(s)», «pendiente(s)». */
function participio(estado: EstadoFacturacion, n: number): string {
  const base = estado.toLowerCase();
  return n === 1 ? base : `${base}s`;
}

export const ESTADO_MESSAGES = {
  invalido: "Elegí un estado de facturación válido.",
  filtro: "El filtro de estado no es válido.",
  confirmar: (n: number, estado: EstadoFacturacion) =>
    estado === ESTADO_PENDIENTE ? `¿Volver ${n} ${n === 1 ? "hora" : "horas"} a pendiente?` : `¿Marcar ${n} ${n === 1 ? "hora" : "horas"} como ${participio(estado, n)}?`,
  hecho: (n: number, estado: EstadoFacturacion) =>
    estado === ESTADO_PENDIENTE
      ? `${n} ${n === 1 ? "hora vuelta" : "horas vueltas"} a pendiente.`
      : `${n} ${n === 1 ? "hora marcada" : "horas marcadas"} como ${participio(estado, n)}.`,
  /** Botón y confirmación del panel de selección. */
  accion: { Pendiente: "Volver a pendiente", Facturada: "Marcar como facturadas", Pagada: "Marcar como pagadas" } as Record<EstadoFacturacion, string>,
} as const;

/** Filtro de un query (`?estado=`): "" / null = todos; otro valor que no sea un estado → error. */
export function filtroEstado(value: string | null | undefined): { estado: EstadoFacturacion | null } | { error: string } {
  if (!value) return { estado: null };
  return isEstadoFacturacion(value) ? { estado: value } : { error: ESTADO_MESSAGES.filtro };
}
