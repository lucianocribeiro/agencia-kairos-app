/**
 * Specs de los 10 Maestros: campos, columnas, reglas entre campos y si se
 * pueden borrar. Client-safe (sin IDs de Airtable): el mapeo a IDs, la
 * unicidad, los links permitidos y las reglas que necesitan la base están en
 * lib/abm/server/maestros-config.ts.
 */
import { formatNumber } from "@/lib/format";
import { parseValues, type FieldErrors, type FieldSpec, type Mode, type RawValues, type Values } from "./fields";

export const MAESTRO_SLUGS = [
  "clientes",
  "proveedores",
  "proyectos",
  "socios",
  "cuentas",
  "categorias",
  "unidades-de-negocio",
  "tipos-de-operacion",
  "tipos-de-comprobante",
  "parametros",
] as const;
export type MaestroSlug = (typeof MAESTRO_SLUGS)[number];

export function isMaestroSlug(value: unknown): value is MaestroSlug {
  return typeof value === "string" && (MAESTRO_SLUGS as readonly string[]).includes(value);
}

export interface MaestroSpec {
  slug: MaestroSlug;
  title: string;
  /** Texto del botón de alta, p. ej. "Nuevo cliente". */
  newLabel: string;
  /** Campo principal: orden de la lista y título del registro. */
  primaryKey: string;
  primaryNumeric?: boolean;
  fields: readonly FieldSpec[];
  columns: readonly string[];
  /** Si la tabla tiene Estado: filtro en la lista (los vacíos se ven como "Sin estado"). */
  estadoKey?: string;
  /** Borrado físico (siempre sujeto al chequeo de referencias). */
  deletable: boolean;
  /** Reglas entre campos. Corre en cliente y servidor. */
  refine?: (values: Values, mode: Mode) => FieldErrors;
}

export const SIN_ESTADO = "Sin estado";

const CONDICION_IVA_CLIENTE = ["Responsable Inscripto", "Monotributista", "Exento", "Consumidor Final", "Cliente del Exterior"] as const;
const CONDICION_IVA_PROVEEDOR = ["Responsable Inscripto", "Monotributista", "Exento", "Consumidor Final", "Proveedor del Exterior"] as const;

const CLIENTE_SIGLA_RE = /^[A-Z]{2}$/;
export const MAESTRO_MESSAGES = {
  clienteSiglaRequerida: "Un Cliente necesita una sigla de 2 letras.",
  clienteSiglaFormato: "La sigla de un Cliente tiene que tener exactamente 2 letras.",
  fechaSaldoRequerida: "Indicá la fecha del saldo inicial.",
} as const;

export const MAESTRO_SPECS: Record<MaestroSlug, MaestroSpec> = {
  clientes: {
    slug: "clientes",
    title: "Clientes",
    newLabel: "Nuevo cliente",
    primaryKey: "nombre",
    estadoKey: "estado",
    deletable: false,
    fields: [
      { key: "nombre", label: "Nombre", kind: "text", required: true },
      { key: "estado", label: "Estado", kind: "select", required: true, options: ["Cliente", "Lead", "Ex cliente", "Perdido"] },
      { key: "sigla", label: "Sigla", kind: "text", uppercase: true, hint: "Obligatoria para Clientes: 2 letras." },
      { key: "cuit", label: "CUIT", kind: "cuit", placeholder: "XX-XXXXXXXX-X" },
      { key: "condicionIva", label: "Condición IVA", kind: "select", options: CONDICION_IVA_CLIENTE },
      { key: "contacto", label: "Contacto", kind: "text" },
      { key: "telefono", label: "Teléfono", kind: "phone" },
      { key: "mail", label: "Mail", kind: "email" },
      { key: "observaciones", label: "Observaciones", kind: "multiline" },
    ],
    columns: ["nombre", "sigla", "estado", "cuit", "condicionIva", "contacto"],
    refine(values) {
      const errors: FieldErrors = {};
      if (values.estado === "Cliente") {
        const sigla = typeof values.sigla === "string" ? values.sigla : "";
        if (!sigla) errors.sigla = MAESTRO_MESSAGES.clienteSiglaRequerida;
        else if (!CLIENTE_SIGLA_RE.test(sigla)) errors.sigla = MAESTRO_MESSAGES.clienteSiglaFormato;
      }
      return errors;
    },
  },

  proyectos: {
    slug: "proyectos",
    title: "Proyectos",
    newLabel: "Nuevo proyecto",
    primaryKey: "codigo",
    estadoKey: "estado",
    deletable: false,
    fields: [
      { key: "codigo", label: "Código", kind: "readonly", hint: "Lo arma el sistema: Sigla del cliente - Nombre corto." },
      { key: "nombreCorto", label: "Nombre corto", kind: "text", required: true },
      { key: "cliente", label: "Cliente", kind: "link", required: true, hint: "Solo clientes con Estado Cliente." },
      { key: "unidadNegocio", label: "Unidad de negocio", kind: "link" },
      { key: "monedaValorHora", label: "Moneda valor hora", kind: "select", options: ["ARS", "USD"] },
      { key: "valorHora", label: "Valor hora", kind: "number", min: 0 },
      { key: "estado", label: "Estado", kind: "select", required: true, options: ["Activo", "Cerrado"] },
      { key: "descripcion", label: "Descripción", kind: "multiline" },
      { key: "usuarios", label: "Empleados asignados", kind: "readonly" },
    ],
    columns: ["codigo", "cliente", "unidadNegocio", "monedaValorHora", "valorHora", "estado"],
  },

  proveedores: {
    slug: "proveedores",
    title: "Proveedores",
    newLabel: "Nuevo proveedor",
    primaryKey: "nombre",
    deletable: true,
    fields: [
      { key: "nombre", label: "Nombre", kind: "text", required: true },
      { key: "cuit", label: "CUIT", kind: "cuit", required: true, placeholder: "XX-XXXXXXXX-X" },
      { key: "condicionIva", label: "Condición IVA", kind: "select", options: CONDICION_IVA_PROVEEDOR },
      { key: "contacto", label: "Contacto", kind: "text" },
      { key: "telefono", label: "Teléfono", kind: "phone" },
      { key: "mail", label: "Mail", kind: "email" },
      { key: "categoriaPorDefecto", label: "Categoría por defecto", kind: "link", hint: "Solo categorías de tipo Gasto." },
      { key: "observaciones", label: "Observaciones", kind: "multiline" },
    ],
    columns: ["nombre", "cuit", "condicionIva", "contacto", "categoriaPorDefecto"],
  },

  socios: {
    slug: "socios",
    title: "Socios",
    newLabel: "Nuevo socio",
    primaryKey: "sigla",
    deletable: true,
    fields: [
      { key: "sigla", label: "Sigla", kind: "text", required: true, uppercase: true },
      { key: "nombre", label: "Nombre", kind: "text" },
      { key: "porcentajeRetiros", label: "% retiros", kind: "percent", min: 0, max: 100, hint: "Entre 0 y 100 (por ejemplo 50 o 33,33)." },
    ],
    columns: ["sigla", "nombre", "porcentajeRetiros"],
  },

  cuentas: {
    slug: "cuentas",
    title: "Cuentas",
    newLabel: "Nueva cuenta",
    primaryKey: "nombre",
    deletable: true,
    fields: [
      { key: "nombre", label: "Nombre", kind: "text", required: true },
      { key: "moneda", label: "Moneda", kind: "select", required: true, options: ["ARS", "USD"] },
      { key: "banco", label: "Banco", kind: "text" },
      { key: "cbu", label: "CBU / N° cuenta", kind: "text" },
      { key: "saldoInicial", label: "Saldo inicial", kind: "number", hint: "Puede ser negativo." },
      { key: "fechaSaldoInicial", label: "Fecha saldo inicial", kind: "date", placeholder: "DD/MM/AAAA" },
    ],
    columns: ["nombre", "moneda", "banco", "cbu", "saldoInicial", "fechaSaldoInicial"],
    refine(values) {
      const errors: FieldErrors = {};
      if (values.saldoInicial !== null && values.saldoInicial !== undefined && !values.fechaSaldoInicial) {
        errors.fechaSaldoInicial = MAESTRO_MESSAGES.fechaSaldoRequerida;
      }
      return errors;
    },
  },

  categorias: {
    slug: "categorias",
    title: "Categorías",
    newLabel: "Nueva categoría",
    primaryKey: "nombre",
    deletable: true,
    fields: [
      { key: "nombre", label: "Nombre", kind: "text", required: true },
      { key: "tipo", label: "Tipo", kind: "select", required: true, options: ["Ingreso", "Gasto"] },
      { key: "requiereProyecto", label: "Requiere proyecto", kind: "checkbox" },
    ],
    columns: ["nombre", "tipo", "requiereProyecto"],
  },

  "unidades-de-negocio": {
    slug: "unidades-de-negocio",
    title: "Unidades de negocio",
    newLabel: "Nueva unidad de negocio",
    primaryKey: "nombre",
    deletable: true,
    fields: [{ key: "nombre", label: "Nombre", kind: "text", required: true }],
    columns: ["nombre"],
  },

  "tipos-de-operacion": {
    slug: "tipos-de-operacion",
    title: "Tipos de operación",
    newLabel: "Nuevo tipo de operación",
    primaryKey: "nombre",
    deletable: true,
    fields: [
      { key: "nombre", label: "Nombre", kind: "text", required: true },
      { key: "movimiento", label: "Movimiento", kind: "select", required: true, options: ["Cobranza", "Pago", "Ambos"] },
      { key: "sumaAResultados", label: "Suma a resultados", kind: "checkbox" },
      { key: "categoriaPorDefecto", label: "Categoría por defecto", kind: "link" },
      { key: "pideClienteProveedor", label: "Pide cliente/proveedor", kind: "checkbox" },
      { key: "esDeSocio", label: "Es de socio", kind: "checkbox" },
    ],
    columns: ["nombre", "movimiento", "sumaAResultados", "categoriaPorDefecto", "pideClienteProveedor", "esDeSocio"],
  },

  "tipos-de-comprobante": {
    slug: "tipos-de-comprobante",
    title: "Tipos de comprobante",
    newLabel: "Nuevo tipo de comprobante",
    primaryKey: "codigo",
    primaryNumeric: true,
    deletable: true,
    fields: [
      { key: "codigo", label: "Código", kind: "integer", required: true },
      { key: "descripcion", label: "Descripción", kind: "text", required: true },
      { key: "signo", label: "Signo", kind: "integer", required: true, numberOptions: [1, -1], hint: "1 o -1." },
    ],
    columns: ["codigo", "descripcion", "signo"],
  },

  parametros: {
    slug: "parametros",
    title: "Parámetros",
    newLabel: "Nuevo parámetro",
    primaryKey: "concepto",
    deletable: false,
    fields: [
      { key: "concepto", label: "Concepto", kind: "text", required: true, lockedOnEdit: true, hint: "No se puede cambiar una vez creado." },
      { key: "valor", label: "Valor", kind: "text" },
      { key: "descripcion", label: "Descripción", kind: "multiline" },
    ],
    columns: ["concepto", "valor", "descripcion"],
  },
};

/** Validación completa de un formulario de Maestro (la misma en cliente y servidor). */
export function validateMaestro(spec: MaestroSpec, raw: RawValues, mode: Mode): { values: Values; errors: FieldErrors } {
  const { values, errors } = parseValues(spec.fields, raw, mode);
  const extra = spec.refine?.(values, mode) ?? {};
  for (const [key, message] of Object.entries(extra)) if (!errors[key]) errors[key] = message;
  return { values, errors };
}

/** Aviso (no error) de Socios: la suma de % retiros tendría que ser 100 %. */
export function sociosSumWarning(porcentajes: readonly (number | null | undefined)[]): string | null {
  const sum = porcentajes.reduce<number>((acc, p) => acc + (typeof p === "number" ? p : 0), 0);
  if (Math.abs(sum - 1) < 1e-6) return null;
  return `La suma de % retiros es ${formatNumber(sum * 100, { maxDecimals: 2 })} %. Debería ser 100 %.`;
}

/** Claves que acepta la API de un Maestro (las del spec, sin las de solo lectura). Slug desconocido → []. */
export function maestroInputKeys(slug: string): readonly string[] {
  return isMaestroSlug(slug) ? MAESTRO_SPECS[slug].fields.filter((f) => f.kind !== "readonly").map((f) => f.key) : [];
}
