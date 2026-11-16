/**
 * DTOs de la vista Cliente (lo único que el servidor le manda a un usuario Cliente).
 * Client-safe. Lista de campos permitidos EXPLÍCITA: el servidor arma cada objeto
 * campo por campo (lib/cliente/server/service.ts) y test/cliente.test.ts falla si
 * aparece cualquier otra clave. Nunca: Tarea, Fecha ni datos por registro, Hora
 * desde/hasta, IDs de Horas o Usuarios, email/sigla/ID del colaborador, Cargado por,
 * Mes a facturar, otros proyectos o clientes, Ventas, Compras, Tesorería, Socios,
 * Cuentas, reportes ni Parámetros (la alícuota solo llega como importes de IVA).
 */
import type { DateRange, Grouping } from "@/lib/horas/dates";
import type { Moneda } from "@/lib/proforma/proforma";

export interface ClienteProyecto {
  id: string;
  codigo: string;
}

export interface ClienteBucket {
  key: string;
  label: string;
}

export interface ClienteFila {
  proyecto: ClienteProyecto;
  /** Horas por período (mismo orden que `buckets`). */
  values: number[];
  total: number;
}

export interface ClienteColaborador {
  nombre: string;
  horas: number;
  /** Centavos; null si el proyecto no tiene valor hora o moneda. */
  neto: number | null;
}

export interface ClienteImporteProyecto {
  id: string;
  codigo: string;
  valorHora: number | null;
  moneda: Moneda | null;
  horas: number;
  /** Centavos; null = «Importe no disponible» (no suma en los totales). */
  neto: number | null;
  iva: number | null;
  total: number | null;
  colaboradores: ClienteColaborador[];
}

export interface ClienteTotalMoneda {
  moneda: Moneda;
  neto: number;
  iva: number;
  total: number;
}

export interface ClienteImportes {
  proyectos: ClienteImporteProyecto[];
  totales: ClienteTotalMoneda[];
}

export interface ClienteHorasData {
  range: DateRange;
  grouping: Grouping;
  buckets: ClienteBucket[];
  /** Proyectos asignados al usuario (el filtro). [] = sin proyectos asignados. */
  proyectos: ClienteProyecto[];
  /** Elegidos en el filtro ([] = todos los asignados). */
  selected: string[];
  rows: ClienteFila[];
  columnTotals: number[];
  total: number;
  /** null = no se pudo calcular (alícuota inválida): se muestran solo las horas. */
  importes: ClienteImportes | null;
}

/** Claves permitidas en una respuesta de app/api/cliente/** (en cualquier nivel). */
export const CLIENTE_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "ok",
  "error",
  "range",
  "desde",
  "hasta",
  "grouping",
  "buckets",
  "key",
  "label",
  "proyectos",
  "selected",
  "rows",
  "proyecto",
  "id",
  "codigo",
  "values",
  "total",
  "columnTotals",
  "importes",
  "valorHora",
  "moneda",
  "horas",
  "neto",
  "iva",
  "colaboradores",
  "nombre",
  "totales",
]);

export const CLIENTE_MESSAGES = {
  noAsignado: "Este proyecto no está asignado a tu usuario.",
  sinProyectos: "No tenés proyectos asignados. Consultá con Agencia Kairos.",
  importe: "No pudimos calcular el importe. Consultá con Agencia Kairos.",
  noDisponible: "Importe no disponible",
} as const;
