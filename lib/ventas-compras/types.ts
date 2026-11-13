/** Tipos de la importación ARCA que viajan entre servidor y cliente. Client-safe. */
import type { Kind } from "./columns";

export interface Ref {
  id: string;
  nombre: string;
}

export type Estado = "nueva" | "ya_importada" | "duplicada" | "error";

export const ESTADO_LABEL: Record<Estado, string> = {
  nueva: "Nueva",
  ya_importada: "Ya importada",
  duplicada: "Duplicada en el archivo",
  error: "Con error",
};

/** Valor de una columna ARCA ya leído: fecha ISO, texto, entero o número. */
export type Dato = string | number | null;

/** Importes en pesos, en centavos enteros y con el signo del comprobante. */
export interface Importes {
  total: number;
  iva: number;
  otros: number;
  neto: number;
}

export interface ProveedorFila {
  /** null = no existe: se crea al confirmar. */
  id: string | null;
  nombre: string;
  /** 11 dígitos */
  cuit: string;
  categoriaPorDefecto: string | null;
}

/** Una fila del archivo con todo lo que no depende de las ediciones. */
export interface FilaBase {
  /** Número de fila en el Excel (1 = primera fila de la hoja). */
  fila: number;
  clave: string | null;
  estado: Estado;
  /** Motivo si estado = "error". */
  error: string | null;
  /** Columnas ARCA por clave (las de columns.ts). Fecha en ISO. */
  datos: Record<string, Dato>;
  codigo: number | null;
  /** 1, −1, o 0 si el tipo no se reconoce. */
  signo: number;
  tipoComprobanteId: string | null;
  importes: Importes;
  /** "YYYY-MM-01" del mes de la Fecha (Mes devengado por defecto). */
  mesFecha: string | null;
  /** Ventas: cliente con el mismo CUIT que el receptor (si no hay proyecto). */
  clientePorCuit: Ref | null;
  /** Compras: proveedor por CUIT del emisor (existente o a crear). */
  proveedor: ProveedorFila | null;
}

/** Lo que el usuario puede cambiar antes de confirmar. Vacío / ausente = valor por defecto. */
export interface Ediciones {
  /** "YYYY-MM" */
  mesDevengado?: string;
  proyecto?: string;
  unidadNegocio?: string;
  categoria?: string;
  /** Solo Compras. */
  socio?: string;
  observaciones?: string;
}

export const EDICION_KEYS = ["mesDevengado", "proyecto", "unidadNegocio", "categoria", "socio", "observaciones"] as const;
export const OBSERVACIONES_MAX = 2000;

export interface ProyectoCtx {
  id: string;
  codigo: string;
  activo: boolean;
  cliente: Ref | null;
  unidadNegocio: string | null;
}

export interface CategoriaCtx {
  id: string;
  nombre: string;
  tipo: string | null;
  requiereProyecto: boolean;
}

export interface Contexto {
  proyectos: ProyectoCtx[];
  unidades: Ref[];
  categorias: CategoriaCtx[];
  socios: Ref[];
  /** Ventas: Parámetro «Categoría por defecto en Ventas» (nombre) y la categoría que le corresponde. */
  categoriaVentasPorDefecto: { nombre: string | null; id: string | null };
}

export interface Resumen {
  total: number;
  nuevas: number;
  yaImportadas: number;
  duplicadas: number;
  conError: number;
}

export interface Preview {
  tipo: Kind;
  filas: FilaBase[];
  contexto: Contexto;
  resumen: Resumen;
  /** Proveedores que se crearían (Compras). */
  proveedoresNuevos: { nombre: string; cuit: string }[];
}

export interface ResultadoImportacion {
  importadas: number;
  omitidas: {
    yaImportadas: number;
    duplicadasEnArchivo: number;
    /** Otra importación en paralelo guardó la misma Clave ARCA primero. */
    enParalelo: number;
  };
  conError: { fila: number; motivo: string }[];
  proveedoresCreados: { nombre: string; cuit: string }[];
}
