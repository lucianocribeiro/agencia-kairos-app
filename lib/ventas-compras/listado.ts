/**
 * Listas de Ventas y Compras: de un comprobante guardado a sus valores efectivos,
 * importes y Control, con las MISMAS funciones que la importación (`evaluar`,
 * `calcularImportes`), así la vista previa y las listas nunca difieren. Puro y
 * client-safe; el servidor arma los `ComprobanteGuardado` desde Airtable.
 */
import type { Kind } from "./columns";
import { calcularImportes, evaluar, MENSAJES, primeroDeMes, soloDigitos, tcAplicado } from "./rules";
import type { Contexto, Dato, Ediciones, FilaBase, Ref } from "./types";

/** Un comprobante tal como está en la base (por clave de schema, no por ID de campo). */
export interface ComprobanteGuardado {
  id: string;
  clave: string;
  /** Columnas ARCA por clave (columns.ts). Fecha en ISO. */
  datos: Record<string, Dato>;
  tipoComprobanteId: string | null;
  /** "AAAA-MM-DD" guardado, o null (= mes de la Fecha). */
  mesDevengado: string | null;
  proyecto: string | null;
  unidadNegocio: string | null;
  categoria: string | null;
  /** Solo Compras. */
  socio: string | null;
  observaciones: string;
  /** Solo Compras. */
  proveedor: string | null;
}

export interface RefsListado {
  /** ID de Tipos de comprobante → código y signo. */
  tipos: ReadonlyMap<string, { codigo: number; signo: number }>;
  /** CUIT (11 dígitos) → cliente (Activo o Inactivo). */
  clientesPorCuit: ReadonlyMap<string, Ref>;
  /** ID de proveedor → datos. */
  proveedores: ReadonlyMap<string, { nombre: string; cuit: string; categoriaPorDefecto: string | null }>;
}

/** Comprobante guardado → la fila de la importación + lo que el usuario guardó como ediciones. */
export function aFila(kind: Kind, c: ComprobanteGuardado, refs: RefsListado): { fila: FilaBase; ed: Ediciones } {
  const num = (k: string) => (typeof c.datos[k] === "number" ? (c.datos[k] as number) : null);
  const tipo = c.tipoComprobanteId ? refs.tipos.get(c.tipoComprobanteId) : undefined;
  const signo = tipo?.signo ?? 0;
  const doc = soloDigitos(String(c.datos[kind === "ventas" ? "nroDocReceptor" : "nroDocEmisor"] ?? ""));
  const prov = kind === "compras" && c.proveedor ? refs.proveedores.get(c.proveedor) : undefined;
  const fila: FilaBase = {
    fila: 0,
    clave: c.clave,
    estado: "nueva",
    error: null,
    datos: c.datos,
    codigo: tipo?.codigo ?? null,
    signo,
    tipoComprobanteId: c.tipoComprobanteId,
    importes: calcularImportes(num("impTotal"), num("totalIva"), num("otrosTributos"), tcAplicado(num("tipoCambio")), signo),
    mesFecha: primeroDeMes(typeof c.datos.fecha === "string" ? c.datos.fecha : null),
    clientePorCuit: kind === "ventas" && doc.length === 11 ? (refs.clientesPorCuit.get(doc) ?? null) : null,
    proveedor: prov && c.proveedor ? { id: c.proveedor, nombre: prov.nombre, cuit: prov.cuit, categoriaPorDefecto: prov.categoriaPorDefecto } : null,
  };
  // Vacío en la base = sin edición: se aplica el valor efectivo por defecto.
  const ed: Ediciones = {};
  if (c.mesDevengado) ed.mesDevengado = c.mesDevengado.slice(0, 7);
  if (c.proyecto) ed.proyecto = c.proyecto;
  if (c.unidadNegocio) ed.unidadNegocio = c.unidadNegocio;
  if (c.categoria) ed.categoria = c.categoria;
  if (kind === "compras" && c.socio) ed.socio = c.socio;
  if (c.observaciones) ed.observaciones = c.observaciones;
  return { fila, ed };
}

export interface FilaListado {
  id: string;
  clave: string;
  datos: Record<string, Dato>;
  /** Centavos con signo. Compras: también impacto en resultados y a cuenta del socio. */
  importes: { total: number; iva: number; neto: number; impacto: number; cuentaSocio: number };
  /** Ventas: cliente efectivo (proyecto → CUIT → ninguno). Compras: proveedor. */
  contraparte: Ref | null;
  /** Efectivo: "AAAA-MM-01". */
  mesDevengado: string | null;
  proyecto: { id: string; codigo: string } | null;
  /** Efectivos. */
  unidadNegocio: Ref | null;
  categoria: Ref | null;
  socio: Ref | null;
  observaciones: string;
  /** Lo guardado (para el formulario; "" = vacío → valor por defecto). */
  guardado: Required<Pick<Ediciones, "mesDevengado" | "proyecto" | "unidadNegocio" | "categoria" | "socio" | "observaciones">>;
  control: string;
}

const refOf = (list: readonly Ref[] | readonly { id: string; nombre: string }[], id: string | null): Ref | null => {
  if (!id) return null;
  const found = list.find((x) => x.id === id);
  return found ? { id: found.id, nombre: found.nombre } : { id, nombre: "(no existe)" };
};

/** Comprobante guardado → fila de la lista (valores efectivos, importes, Control). */
export function evaluarComprobante(kind: Kind, c: ComprobanteGuardado, refs: RefsListado, ctx: Contexto): FilaListado {
  const { fila, ed } = aFila(kind, c, refs);
  const ev = evaluar(kind, fila, ed, ctx);
  const proyecto = ed.proyecto ? (ctx.proyectos.find((p) => p.id === ed.proyecto) ?? { id: ed.proyecto, codigo: "(no existe)" }) : null;
  return {
    id: c.id,
    clave: c.clave,
    datos: c.datos,
    importes: { total: fila.importes.total, iva: fila.importes.iva, neto: fila.importes.neto, impacto: ev.impactoResultados, cuentaSocio: ev.cuentaSocio },
    contraparte: kind === "ventas" ? ev.cliente : fila.proveedor ? { id: fila.proveedor.id!, nombre: fila.proveedor.nombre } : null,
    mesDevengado: ev.mesDevengado,
    proyecto: proyecto ? { id: proyecto.id, codigo: proyecto.codigo } : null,
    unidadNegocio: refOf(ctx.unidades, ev.unidadNegocio),
    categoria: refOf(ctx.categorias, ev.categoria),
    socio: refOf(ctx.socios, ev.socio),
    observaciones: c.observaciones,
    guardado: {
      mesDevengado: ed.mesDevengado ?? "",
      proyecto: ed.proyecto ?? "",
      unidadNegocio: ed.unidadNegocio ?? "",
      categoria: ed.categoria ?? "",
      socio: ed.socio ?? "",
      observaciones: ed.observaciones ?? "",
    },
    control: ev.control,
  };
}

// ── Filtros y totales ───────────────────────────────────────────────────────

export const SIN_PROYECTO = "sin";

/** Filtro de Control: OK, «con observaciones» (cualquiera ≠ OK) o un mensaje puntual (clave de MENSAJES). */
export const CONTROL_FILTROS: Record<Kind, { value: string; label: string }[]> = {
  ventas: [
    { value: "ok", label: "OK" },
    { value: "observaciones", label: "Con observaciones" },
    ...(["tipoNoReconocido", "categoriaInexistente", "noEsIngreso", "proyectoInexistente", "faltaProyecto", "sinCliente"] as const).map((k) => ({ value: k, label: MENSAJES[k] })),
  ],
  compras: [
    { value: "ok", label: "OK" },
    { value: "observaciones", label: "Con observaciones" },
    ...(["tipoNoReconocido", "socioInexistente", "faltaCategoria", "categoriaInexistente", "noEsGasto", "proyectoInexistente", "faltaProyecto"] as const).map((k) => ({
      value: k,
      label: MENSAJES[k],
    })),
  ],
};

export interface FiltrosListado {
  /** Mes devengado efectivo, "AAAA-MM" (incluidos). */
  mesDesde?: string | null;
  mesHasta?: string | null;
  /** Cliente efectivo (Ventas) o Proveedor (Compras): ID. */
  contraparte?: string | null;
  /** ID de proyecto o SIN_PROYECTO. */
  proyecto?: string | null;
  /** Categoría efectiva (incluye la por defecto). */
  categoria?: string | null;
  /** Valor de CONTROL_FILTROS. */
  control?: string | null;
}

/** Filtros por valores efectivos (se aplican en código). La Fecha se filtra antes, en el servidor. */
export function filtrar(rows: readonly FilaListado[], f: FiltrosListado): FilaListado[] {
  const controlMessage = f.control && f.control !== "ok" && f.control !== "observaciones" ? (MENSAJES as Record<string, string>)[f.control] : null;
  return rows.filter((r) => {
    const mes = r.mesDevengado?.slice(0, 7) ?? "";
    if (f.mesDesde && !(mes && mes >= f.mesDesde)) return false;
    if (f.mesHasta && !(mes && mes <= f.mesHasta)) return false;
    if (f.contraparte && r.contraparte?.id !== f.contraparte) return false;
    if (f.proyecto === SIN_PROYECTO && r.proyecto) return false;
    if (f.proyecto && f.proyecto !== SIN_PROYECTO && r.proyecto?.id !== f.proyecto) return false;
    if (f.categoria && r.categoria?.id !== f.categoria) return false;
    if (f.control === "ok" && r.control !== MENSAJES.ok) return false;
    if (f.control === "observaciones" && r.control === MENSAJES.ok) return false;
    if (controlMessage && r.control !== controlMessage) return false;
    return true;
  });
}

export interface Totales {
  total: number;
  iva: number;
  neto: number;
  impacto: number;
  cuentaSocio: number;
}

/** Totales en centavos (enteros: sin error de punto flotante). */
export function totalizar(rows: readonly FilaListado[]): Totales {
  const t: Totales = { total: 0, iva: 0, neto: 0, impacto: 0, cuentaSocio: 0 };
  for (const r of rows) {
    t.total += r.importes.total;
    t.iva += r.importes.iva;
    t.neto += r.importes.neto;
    t.impacto += r.importes.impacto;
    t.cuentaSocio += r.importes.cuentaSocio;
  }
  return t;
}

/** Fecha desc; a igual fecha, Clave ARCA desc (código, PV y número). */
export function ordenar(rows: FilaListado[]): FilaListado[] {
  return rows.sort((a, b) => String(b.datos.fecha ?? "").localeCompare(String(a.datos.fecha ?? "")) || b.clave.localeCompare(a.clave, "es", { numeric: true }));
}
