/**
 * Dashboard del Admin con importes (CC-F4-11). Client-safe: tipos, textos y la vista que
 * comparten la pantalla y el Excel. Los importes son EXACTAMENTE los de la vista Cliente:
 * mismo cálculo (`calcularImportesCliente`) y mismas tablas (`tablasImportes`).
 */
import type { ClienteImportes } from "@/lib/cliente/types";
import { codigoParaArchivo, tablasImportes } from "@/lib/cliente/vista";
import type { Vista, VistaColumna, VistaFila, VistaTabla } from "@/lib/reportes/vista";
import { displayDate, GROUPINGS } from "./dates";
import type { EstadoFacturacion } from "./estado";
import type { DashboardData } from "./types";

export interface DashboardCliente {
  id: string;
  nombre: string;
  sigla: string;
}

export interface DashboardAdminData extends DashboardData {
  /** Clientes con al menos un proyecto (filtro «Cliente»), por nombre. */
  clientes: DashboardCliente[];
  /** Cliente elegido (null = todos). */
  cliente: string | null;
  /** Estado de facturación elegido (null = todos). */
  estado: EstadoFacturacion | null;
  /** Importes (solo horas Facturables). null = alícuota inválida: se muestran solo las horas. */
  importes: ClienteImportes | null;
}

export const DASHBOARD_ADMIN_MESSAGES = {
  cliente: "El cliente no existe o no tiene proyectos.",
  soloFacturables: "Sólo horas facturables.",
  titulo: "Dashboard",
} as const;

export const SIN_PROYECTO_LABEL = "(sin proyecto)";

const nombreCliente = (d: Pick<DashboardAdminData, "cliente" | "clientes">) => (d.cliente ? (d.clientes.find((c) => c.id === d.cliente)?.nombre ?? "—") : "Todos");

/** Tabla de horas del Admin (todas las horas, facturables o no), con totales. */
export function tablaHorasAdmin(d: DashboardAdminData): VistaTabla {
  return {
    titulo: "Horas por proyecto",
    columnas: [{ label: "Proyecto", kind: "text" }, ...d.buckets.map((b): VistaColumna => ({ label: b.label, kind: "hours" })), { label: "Total", kind: "hours" }],
    filas: [
      ...d.rows.map((r): VistaFila => ({ cells: [r.proyecto?.codigo ?? SIN_PROYECTO_LABEL, ...r.values, r.total] })),
      { cells: ["Total", ...d.columnTotals, d.total], total: true },
    ],
  };
}

/** Lo que muestra la pantalla y exporta el Excel: horas + el bloque de importes de la vista Cliente. */
export function vistaDashboardAdmin(d: DashboardAdminData): Vista {
  const codigos = d.selected.map((id) => d.proyectos.find((p) => p.id === id)?.codigo ?? id);
  return {
    titulo: DASHBOARD_ADMIN_MESSAGES.titulo,
    lineas: [
      `${displayDate(d.range.desde)} al ${displayDate(d.range.hasta)} · Agrupación ${GROUPINGS[d.grouping].toLowerCase()}`,
      `Cliente: ${nombreCliente(d)}`,
      `Proyectos: ${codigos.join(", ") || "todos con horas"}`,
      `Estado de facturación: ${d.estado ?? "Todos"}`,
      `Importes: ${DASHBOARD_ADMIN_MESSAGES.soloFacturables.toLowerCase()}`,
    ],
    avisos: [],
    error: null,
    tablas: [tablaHorasAdmin(d), ...tablasImportes(d)],
  };
}

/** «Dashboard_<Sigla del cliente o Todos>_<AAAA-MM-DD>_<AAAA-MM-DD>.xlsx». */
export function nombreArchivoDashboard(d: DashboardAdminData): string {
  const sigla = d.cliente ? codigoParaArchivo(d.clientes.find((c) => c.id === d.cliente)?.sigla ?? "") : "";
  return `Dashboard_${sigla || "Todos"}_${d.range.desde}_${d.range.hasta}.xlsx`;
}
