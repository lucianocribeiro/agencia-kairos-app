/** DTOs de Horas, Mis horas y Dashboard que viajan al cliente. Client-safe (sin IDs de Airtable). */
import type { Bucket, DateRange, Grouping } from "./dates";

export type Ref = { id: string; nombre: string } | null;

export interface ProyectoRef {
  id: string;
  codigo: string;
}

/** Lo único que ve un Empleado de un registro. */
export interface MiHoraDTO {
  id: string;
  fecha: string;
  proyecto: ProyectoRef;
  tarea: string;
  desde: string;
  hasta: string;
  horas: number;
}

export interface MisProyectos {
  /** Asignados y Activos: los que puede cargar (GET /api/me/proyectos). */
  activos: ProyectoRef[];
  /** Todos los asignados (también Cerrados): el filtro de la lista. */
  asignados: ProyectoRef[];
}

export interface MisHorasData {
  range: DateRange;
  records: MiHoraDTO[];
  total: number;
}

export interface UsuarioOption {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface ProyectoOption {
  id: string;
  codigo: string;
  estado: string | null;
  cliente: string | null;
}

export interface ClienteOption {
  id: string;
  nombre: string;
  /** Estado = Activo. Los filtros solo ofrecen activos; los inactivos quedan para mostrar el nombre en registros viejos. */
  activo: boolean;
}

export interface HorasOptions {
  usuarios: UsuarioOption[];
  proyectos: ProyectoOption[];
  clientes: ClienteOption[];
}

export interface HoraAdminDTO {
  id: string;
  fecha: string;
  colaborador: Ref;
  proyecto: { id: string; codigo: string; estado: string | null } | null;
  cliente: Ref;
  tarea: string;
  desde: string;
  hasta: string;
  horas: number;
  facturable: boolean;
  /** "YYYY-MM-01" o null. */
  mesAFacturar: string | null;
  cargadoPor: Ref;
}

export interface HorasAdminData {
  range: DateRange;
  records: HoraAdminDTO[];
  total: number;
}

export interface DashboardProject {
  id: string;
  codigo: string;
  estado: string | null;
}

export interface DashboardRow {
  /** null = registros sin proyecto. */
  proyecto: DashboardProject | null;
  values: number[];
  total: number;
}

export interface DashboardData {
  range: DateRange;
  grouping: Grouping;
  buckets: Bucket[];
  rows: DashboardRow[];
  columnTotals: number[];
  total: number;
  /** Todos los proyectos, con su Estado (para el selector). */
  proyectos: DashboardProject[];
  /** Proyectos elegidos explícitamente ([] = todos los que tienen horas). */
  selected: string[];
}
