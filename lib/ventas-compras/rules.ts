/**
 * Reglas de Ventas y Compras (de Gestion_Kairos_ERP_v4.xlsx), en código. Client-safe:
 * la vista previa las usa para recalcular al editar, y el servidor las vuelve a correr
 * al confirmar (fuente de verdad). No leen las fórmulas de Airtable.
 */
import { displayDateToIso } from "@/lib/format";
import type { Kind } from "./columns";
import { toCents } from "./money";
import type { CategoriaCtx, Contexto, Ediciones, FilaBase, Importes, ProyectoCtx, Ref } from "./types";

export const MENSAJES = {
  tipoNoReconocido: "Tipo de comprobante no reconocido",
  monedaSinTc: "Moneda extranjera sin tipo de cambio",
  cuitEmisorInvalido: "CUIT del emisor inválido",
  categoriaInexistente: "Categoría inexistente",
  noEsIngreso: "La categoría no es de ingreso",
  noEsGasto: "La categoría no es de gasto",
  proyectoInexistente: "Proyecto inexistente",
  faltaProyecto: "Falta proyecto",
  sinCliente: "Cliente sin identificar",
  socioInexistente: "Socio inexistente",
  faltaCategoria: "Falta categoría",
  ok: "OK",
} as const;

// ── Celdas ───────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Número de serie de Excel (sistema 1900) → "AAAA-MM-DD". Excel cuenta el 29/02/1900,
 * que no existió: 1 = 01/01/1900, 59 = 28/02/1900, 60 = el 29/02 falso (→ null,
 * «Fecha inválida»), 61 = 01/03/1900; de ahí en adelante la cuenta es exacta.
 * La parte decimal (hora) se descarta. Fuera de 1..2958465 (31/12/9999) → null.
 */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const day = Math.floor(serial);
  if (day < 1 || day > 2958465 || day === 60) return null;
  const epoch = day < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + day * DAY_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Fecha de Excel (número de serie, sistema 1900) o texto DD/MM/AAAA (también AAAA-MM-DD) → "AAAA-MM-DD". */
export function parseFecha(value: unknown): string | null {
  if (typeof value === "number") return excelSerialToIso(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return displayDateToIso(`${iso[3]}/${iso[2]}/${iso[1]}`);
  return displayDateToIso(text);
}

/**
 * Número de una celda: número de Excel, o texto es-AR ("1.234,56", "1234,56", "-15,5").
 * También "1234.56" (un punto y 1–2 decimales). Vacío → null; inválido → NaN.
 */
export function parseNumero(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const text = String(value).trim().replace(/\s+/g, "");
  if (!text) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$|^-?\d+(,\d+)?$/.test(text)) return Number(text.replace(/\./g, "").replace(",", "."));
  if (/^-?\d+\.\d{1,2}$/.test(text)) return Number(text);
  return NaN;
}

/** Entero sin ceros a la izquierda ("00002" → 2). Vacío → null; inválido → NaN. */
export function parseEntero(value: unknown): number | null {
  const n = parseNumero(value);
  if (n === null) return null;
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

/** Texto de una celda (los números se pasan a texto sin notación científica). */
export function parseTexto(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? BigInt(value).toString() : String(value);
  return String(value).trim();
}

/** Solo dígitos (documentos). */
export const soloDigitos = (text: string) => text.replace(/\D/g, "");

// ── Reglas ───────────────────────────────────────────────────────────────────

/** Código comprobante = texto del Tipo hasta el primer espacio ("11 - Factura C" → 11). */
export function codigoDeTipo(tipo: unknown): number | null {
  if (typeof tipo === "number") return Number.isInteger(tipo) ? tipo : null;
  const first = String(tipo ?? "").trim().split(/\s/)[0] ?? "";
  return /^\d+$/.test(first) ? Number(first) : null;
}

/** TC = Tipo Cambio si es > 0; si no, 1. */
export function tcAplicado(tipoCambio: number | null): number {
  return tipoCambio !== null && tipoCambio > 0 ? tipoCambio : 1;
}

/** Pesos: "$", "PES" o vacío (sin distinguir mayúsculas, sin espacios). */
export function esPesos(moneda: unknown): boolean {
  const m = String(moneda ?? "").trim().toUpperCase();
  return m === "" || m === "$" || m === "PES";
}

/** Moneda extranjera sin tipo de cambio (> 0) → error de fila (no se importa). */
export function monedaSinTipoCambio(moneda: unknown, tipoCambio: number | null): boolean {
  return !esPesos(moneda) && !(tipoCambio !== null && tipoCambio > 0);
}

/**
 * Total $ = round2(Imp. Total × TC) × Signo · IVA $ = round2(Total IVA × TC) × Signo ·
 * Neto $ = Total $ − IVA $ − round2(Otros Tributos × TC) × Signo. Vacíos = 0. En centavos.
 */
export function calcularImportes(impTotal: number | null, totalIva: number | null, otrosTributos: number | null, tc: number, signo: number): Importes {
  const total = toCents((impTotal ?? 0) * tc) * signo;
  const iva = toCents((totalIva ?? 0) * tc) * signo;
  const otros = toCents((otrosTributos ?? 0) * tc) * signo;
  return { total: total || 0, iva: iva || 0, otros: otros || 0, neto: total - iva - otros || 0 };
}

/**
 * Clave ARCA = "Código|Punto de venta|Número desde|Documento": Código del tipo,
 * enteros sin ceros a la izquierda, documento solo con dígitos (como viene, sin
 * sacar ceros). Ventas usa el documento del receptor; Compras, el del emisor.
 * Ej.: "11|2|1234|20123456786".
 */
export function claveArca(codigo: number, puntoVenta: number, numeroDesde: number, documento: string): string {
  return `${codigo}|${puntoVenta}|${numeroDesde}|${soloDigitos(documento)}`;
}

/** "AAAA-MM-DD" → "AAAA-MM-01". */
export const primeroDeMes = (iso: string | null): string | null => (iso ? `${iso.slice(0, 7)}-01` : null);

// ── Evaluación (depende de las ediciones) ─────────────────────────────────────

export interface Evaluacion {
  proyecto: ProyectoCtx | null;
  /** Ventas: del proyecto o por CUIT. */
  cliente: Ref | null;
  /** Efectiva: la elegida o la del proyecto. */
  unidadNegocio: string | null;
  /** Efectiva: la elegida, o la por defecto (Ventas: Parámetro; Compras: del proveedor). */
  categoria: string | null;
  /** Efectivo: el elegido o el mes de la Fecha ("AAAA-MM-01"). */
  mesDevengado: string | null;
  socio: string | null;
  control: string;
  /** Compras (centavos): −Neto $ sin socio, 0 con socio. */
  impactoResultados: number;
  /** Compras (centavos): Neto $ con socio, 0 sin socio. */
  cuentaSocio: number;
}

const has = (v: string | undefined): v is string => typeof v === "string" && v !== "";

/** Categoría efectiva (ID o null) antes de buscarla. Compras: "" en las ediciones = sin categoría. */
function categoriaEfectiva(kind: Kind, fila: FilaBase, ed: Ediciones, ctx: Contexto): string | null {
  if (kind === "ventas") return has(ed.categoria) ? ed.categoria : ctx.categoriaVentasPorDefecto.nombre ? (ctx.categoriaVentasPorDefecto.id ?? "") : null;
  if (ed.categoria !== undefined) return has(ed.categoria) ? ed.categoria : null;
  return fila.proveedor?.categoriaPorDefecto ?? null;
}

/**
 * Calcula los valores efectivos y el Control de una fila. El Control es el primer
 * mensaje que falla, en el mismo orden que la columna CONTROL del Excel.
 */
export function evaluar(kind: Kind, fila: FilaBase, ed: Ediciones, ctx: Contexto): Evaluacion {
  const proyectoId = has(ed.proyecto) ? ed.proyecto : null;
  const proyecto = proyectoId ? (ctx.proyectos.find((p) => p.id === proyectoId) ?? null) : null;
  const categoriaId = categoriaEfectiva(kind, fila, ed, ctx);
  const categoria: CategoriaCtx | null = categoriaId ? (ctx.categorias.find((c) => c.id === categoriaId) ?? null) : null;
  const socioId = kind === "compras" && has(ed.socio) ? ed.socio : null;
  const socio = socioId ? (ctx.socios.find((s) => s.id === socioId) ?? null) : null;
  const cliente = kind === "ventas" ? (proyecto?.cliente ?? (proyectoId ? null : fila.clientePorCuit)) : null;

  let control: string = MENSAJES.ok;
  const checks: [boolean, string][] =
    kind === "ventas"
      ? [
          [fila.signo === 0, MENSAJES.tipoNoReconocido],
          [categoriaId === null || !categoria, MENSAJES.categoriaInexistente],
          [!!categoria && categoria.tipo !== "Ingreso", MENSAJES.noEsIngreso],
          [!!proyectoId && !proyecto, MENSAJES.proyectoInexistente],
          [!proyectoId && !!categoria?.requiereProyecto, MENSAJES.faltaProyecto],
          [!cliente, MENSAJES.sinCliente],
        ]
      : [
          [fila.signo === 0, MENSAJES.tipoNoReconocido],
          [!!socioId && !socio, MENSAJES.socioInexistente],
          [!socioId && categoriaId === null, MENSAJES.faltaCategoria],
          [categoriaId !== null && !categoria, MENSAJES.categoriaInexistente],
          [!!categoria && categoria.tipo !== "Gasto", MENSAJES.noEsGasto],
          [!!proyectoId && !proyecto, MENSAJES.proyectoInexistente],
          [!socioId && !proyectoId && !!categoria?.requiereProyecto, MENSAJES.faltaProyecto],
        ];
  for (const [fails, message] of checks) {
    if (fails) {
      control = message;
      break;
    }
  }

  const neto = fila.importes.neto;
  return {
    proyecto,
    cliente,
    unidadNegocio: has(ed.unidadNegocio) ? ed.unidadNegocio : (proyecto?.unidadNegocio ?? null),
    categoria: categoriaId || null,
    mesDevengado: has(ed.mesDevengado) ? `${ed.mesDevengado}-01` : fila.mesFecha,
    socio: socioId,
    control,
    impactoResultados: kind === "compras" && !socioId ? -neto || 0 : 0,
    cuentaSocio: kind === "compras" && socioId ? neto : 0,
  };
}
