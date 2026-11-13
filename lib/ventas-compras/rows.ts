/**
 * Del archivo a las filas: encabezados, lectura de cada celda y la parte de las
 * reglas que no depende de las ediciones (código, signo, importes, Clave ARCA,
 * estado). Puro (sin Airtable): el servidor le pasa lo que leyó de la base.
 */
import { parseCuit } from "@/lib/cuit";
import { COLUMNS, KIND_LABEL, normalizeHeader, type Column, type Kind } from "./columns";
import {
  calcularImportes,
  claveArca,
  codigoDeTipo,
  MENSAJES,
  monedaSinTipoCambio,
  parseEntero,
  parseFecha,
  parseNumero,
  parseTexto,
  primeroDeMes,
  soloDigitos,
  tcAplicado,
} from "./rules";
import type { Dato, FilaBase, ProveedorFila, Ref, Resumen } from "./types";

export const MAX_FILAS = 1000;
/** Tope de cualquier importe o tipo de cambio leído (1e12). */
export const MAX_IMPORTE = 1e12;
const HEADER_SCAN_ROWS = 30;

export const ARCHIVO_MENSAJES = {
  sinEncabezados: (kind: Kind) =>
    `No encontramos los encabezados de ARCA. Subí el .xlsx de «${KIND_LABEL[kind].archivo}» tal como lo descargás.`,
  faltanColumnas: (cols: string[]) =>
    `${cols.length === 1 ? "Falta la columna" : "Faltan las columnas"} ${cols.map((c) => `«${c}»`).join(", ")}. No se importó nada.`,
  tipoEquivocado: (kind: Kind) =>
    `Este archivo es de «${KIND_LABEL[KIND_LABEL[kind].otro].archivo}» (${KIND_LABEL[KIND_LABEL[kind].otro].titulo}). Subilo en ${KIND_LABEL[KIND_LABEL[kind].otro].titulo} › Importar.`,
  sinFilas: "El archivo no tiene comprobantes.",
  demasiadasFilas: (n: number) => `El archivo tiene ${n} comprobantes; el máximo por importación es ${MAX_FILAS}. Dividilo por período.`,
} as const;

export type Cell = string | number | boolean | null;

export interface HeaderMatch {
  /** Índice (0) de la fila de encabezados en la hoja. */
  row: number;
  /** clave de columna → índice de columna */
  index: Record<string, number>;
}

/**
 * Busca la fila de encabezados por nombre de columna (no por posición; puede haber un
 * título arriba). Detecta el archivo equivocado (Emitidos en Compras o al revés).
 */
export function findHeader(kind: Kind, rows: readonly (readonly Cell[])[]): HeaderMatch | { error: string } {
  const all = new Set([...COLUMNS.ventas, ...COLUMNS.compras].map((c) => normalizeHeader(c.header)));
  let best = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const score = rows[r].filter((cell) => all.has(normalizeHeader(cell))).length;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  if (best < 0 || bestScore < 3) return { error: ARCHIVO_MENSAJES.sinEncabezados(kind) };
  const names = rows[best].map((cell) => normalizeHeader(cell));
  const hasEmisor = names.includes(normalizeHeader("Denominación Emisor"));
  const hasReceptorName = names.includes(normalizeHeader("Denominación Receptor"));
  if (kind === "ventas" && hasEmisor) return { error: ARCHIVO_MENSAJES.tipoEquivocado(kind) };
  if (kind === "compras" && !hasEmisor && hasReceptorName) return { error: ARCHIVO_MENSAJES.tipoEquivocado(kind) };

  const index: Record<string, number> = {};
  const missing: string[] = [];
  for (const col of COLUMNS[kind]) {
    const i = names.indexOf(normalizeHeader(col.header));
    if (i < 0) missing.push(col.header);
    else index[col.key] = i;
  }
  if (missing.length > 0) return { error: ARCHIVO_MENSAJES.faltanColumnas(missing) };
  return { row: best, index };
}

/** Lo que el servidor lee de la base para armar las filas. */
export interface Referencias {
  /** Código → tipo de comprobante. */
  tipos: ReadonlyMap<number, { id: string; signo: number }>;
  /** Ventas: CUIT (11 dígitos) → cliente. */
  clientesPorCuit: ReadonlyMap<string, Ref>;
  /** Compras: CUIT (11 dígitos) → proveedor existente. */
  proveedoresPorCuit: ReadonlyMap<string, { id: string; nombre: string; categoriaPorDefecto: string | null }>;
  /** Claves ARCA que ya están en la tabla. */
  clavesExistentes: ReadonlySet<string>;
}

function readCell(col: Column, raw: Cell): { value: Dato } | { error: string } {
  const value = typeof raw === "boolean" ? Number(raw) : raw;
  switch (col.type) {
    case "fecha": {
      const iso = parseFecha(value);
      return iso ? { value: iso } : { error: "Fecha inválida" };
    }
    case "entero": {
      const n = parseEntero(value);
      if (Number.isNaN(n) || (n !== null && n > Number.MAX_SAFE_INTEGER)) return { error: `Número inválido en «${col.header}»` };
      return { value: n };
    }
    case "numero": {
      const n = parseNumero(value);
      if (Number.isNaN(n)) return { error: `Número inválido en «${col.header}»` };
      // Importes y tipo de cambio razonables: evita Infinity al multiplicar (y un 500).
      if (n !== null && Math.abs(n) > MAX_IMPORTE) return { error: `Número fuera de rango en «${col.header}»` };
      return { value: n };
    }
    default:
      return { value: parseTexto(value) };
  }
}

const isEmptyRow = (row: readonly Cell[]) => row.every((c) => c === null || c === "" || (typeof c === "string" && c.trim() === ""));

/**
 * Filas de datos → FilaBase. Estado: error (no se importa) → ya importada (Clave
 * ARCA en la tabla) → duplicada en el archivo (2.ª aparición) → nueva.
 */
export function buildRows(kind: Kind, rows: readonly (readonly Cell[])[], header: HeaderMatch, refs: Referencias): FilaBase[] | { error: string } {
  const data: { fila: number; cells: readonly Cell[] }[] = [];
  for (let r = header.row + 1; r < rows.length; r++) if (!isEmptyRow(rows[r])) data.push({ fila: r + 1, cells: rows[r] });
  if (data.length === 0) return { error: ARCHIVO_MENSAJES.sinFilas };
  if (data.length > MAX_FILAS) return { error: ARCHIVO_MENSAJES.demasiadasFilas(data.length) };

  const seen = new Set<string>();
  const nuevosProveedores = new Map<string, ProveedorFila>();
  return data.map(({ fila, cells }) => {
    const datos: Record<string, Dato> = {};
    let error: string | null = null;
    for (const col of COLUMNS[kind]) {
      const read = readCell(col, cells[header.index[col.key]] ?? null);
      if ("error" in read) {
        error ??= read.error;
        datos[col.key] = null;
      } else datos[col.key] = read.value;
    }
    const num = (k: string) => (typeof datos[k] === "number" ? (datos[k] as number) : null);
    const codigo = codigoDeTipo(datos.tipo);
    const tipo = codigo !== null ? refs.tipos.get(codigo) : undefined;
    const signo = tipo?.signo ?? 0;
    const tc = num("tipoCambio");
    const importes = calcularImportes(num("impTotal"), num("totalIva"), num("otrosTributos"), tcAplicado(tc), signo);

    if (!error && datos.fecha === null) error = "Fecha inválida";
    if (!error && (num("puntoVenta") === null || num("numeroDesde") === null)) error = "Falta el punto de venta o el número";
    if (!error && signo === 0) error = MENSAJES.tipoNoReconocido;
    if (!error && monedaSinTipoCambio(datos.moneda, tc)) error = MENSAJES.monedaSinTc;

    const docKey = kind === "ventas" ? "nroDocReceptor" : "nroDocEmisor";
    const doc = String(datos[docKey] ?? "");
    let proveedor: ProveedorFila | null = null;
    if (kind === "compras" && !error) {
      const cuit = parseCuit(doc);
      if ("error" in cuit) error = MENSAJES.cuitEmisorInvalido;
      else {
        const existing = refs.proveedoresPorCuit.get(cuit.digits);
        const nombre = String(datos.denominacionEmisor ?? "").trim() || cuit.digits;
        proveedor = existing
          ? { id: existing.id, nombre: existing.nombre, cuit: cuit.digits, categoriaPorDefecto: existing.categoriaPorDefecto }
          : (nuevosProveedores.get(cuit.digits) ?? { id: null, nombre, cuit: cuit.digits, categoriaPorDefecto: null });
        if (!existing) nuevosProveedores.set(cuit.digits, proveedor);
      }
    }
    const docDigits = soloDigitos(doc);
    const clientePorCuit = kind === "ventas" && docDigits.length === 11 ? (refs.clientesPorCuit.get(docDigits) ?? null) : null;

    const clave = codigo !== null && num("puntoVenta") !== null && num("numeroDesde") !== null && tipo
      ? claveArca(codigo, num("puntoVenta")!, num("numeroDesde")!, doc)
      : null;
    let estado: FilaBase["estado"] = "nueva";
    if (error) estado = "error";
    else if (clave && refs.clavesExistentes.has(clave)) estado = "ya_importada";
    else if (clave && seen.has(clave)) estado = "duplicada";
    if (clave && !error) seen.add(clave);

    return {
      fila,
      clave: error ? null : clave,
      estado,
      error,
      datos,
      codigo,
      signo,
      tipoComprobanteId: tipo?.id ?? null,
      importes,
      mesFecha: primeroDeMes(typeof datos.fecha === "string" ? datos.fecha : null),
      clientePorCuit,
      proveedor,
    };
  });
}

export function resumir(filas: readonly FilaBase[]): Resumen {
  const count = (e: FilaBase["estado"]) => filas.filter((f) => f.estado === e).length;
  return { total: filas.length, nuevas: count("nueva"), yaImportadas: count("ya_importada"), duplicadas: count("duplicada"), conError: count("error") };
}

/** Proveedores que la importación crearía (uno por CUIT, solo de filas nuevas). */
export function proveedoresNuevos(filas: readonly FilaBase[]): { nombre: string; cuit: string }[] {
  const out = new Map<string, { nombre: string; cuit: string }>();
  for (const f of filas) if (f.estado === "nueva" && f.proveedor && !f.proveedor.id) out.set(f.proveedor.cuit, { nombre: f.proveedor.nombre, cuit: f.proveedor.cuit });
  return [...out.values()];
}
