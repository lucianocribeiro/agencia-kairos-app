import "server-only";

import { getAirtableClient, type Fields } from "@/lib/airtable/client";
import { normalizeForUnique, WrittenRecordMissingError } from "@/lib/airtable/integrity";
import { REFERENCE_FIELDS, TABLES, type FieldId, type TableKey } from "@/lib/airtable/schema";
import type { FieldErrors, Mode, Values } from "@/lib/abm/fields";
import { isClienteActivo } from "@/lib/abm/cliente-estado";
import { MAESTRO_SPECS, type MaestroSlug, type MaestroSpec } from "@/lib/abm/maestros";
import type { CheckConflict } from "./compensation";

/**
 * Parte de servidor de cada Maestro: IDs de campo, unicidad, de dónde salen las
 * opciones de los links (y cuáles se pueden elegir), referencias que bloquean el
 * borrado y reglas que necesitan leer la base (Código de Proyectos, cascada de
 * siglas de Clientes).
 */

export interface LinkSource {
  table: TableKey;
  /** Campos a leer de la tabla destino (para la etiqueta, `allow` y `show`). */
  fields: readonly FieldId[];
  label: (f: Fields) => string;
  /** Solo estas opciones se pueden elegir. Lo que ya estaba guardado se puede mantener. */
  allow?: (f: Fields) => boolean;
  /** Al mostrar el valor guardado, solo se ven estos registros (p. ej. solo Empleados). */
  show?: (f: Fields) => boolean;
}

export interface WriteContext {
  mode: Mode;
  /** ID del registro (al editar). */
  id?: string;
  /** Valores parseados, por clave del spec. */
  values: Values;
  /** Registro actual, por ID de campo (al editar). */
  existing?: Fields;
}

/** Update de otro registro que acompaña la escritura (p. ej. Códigos de proyectos). */
export interface RelatedUpdate {
  table: TableKey;
  id: string;
  fields: Fields;
  /** Valores originales, para el rollback. */
  previous: Fields;
}

export interface WritePlan {
  /** Campos extra que arma el servidor (p. ej. Código). Por ID de campo. */
  extraFields?: Fields;
  /** Reglas de campo que no se cumplen → 400. */
  invalid?: FieldErrors;
  /** Choque con otros registros (duplicados, colisiones de la cascada) → 409. */
  conflict?: { error: string; fieldErrors?: FieldErrors };
  /**
   * Updates relacionados, pre-validados. Se escriben ANTES del registro
   * principal, en lotes de 10; si algo falla se revierte todo (ver write()).
   */
  related?: RelatedUpdate[];
  /** Verificación después de escribir (carreras): devuelve un conflicto (409) o null. Si lanza → 503 (fail-closed). */
  verify?: () => Promise<CheckConflict | null>;
}

export interface MaestroConfig {
  spec: MaestroSpec;
  table: TableKey;
  /** clave del spec → ID de campo (incluye los readonly que se muestran). */
  fieldIds: Record<string, FieldId>;
  /** Claves que tienen que ser únicas (trim + sin distinguir mayúsculas). */
  unique?: readonly string[];
  links?: Record<string, LinkSource>;
  /** Links inversos que impiden borrar (REFERENCE_FIELDS de schema.ts). */
  references: readonly FieldId[];
  /**
   * Mensaje del 409 de borrado con lo que lo referencia y cuántos (p. ej. Clientes).
   * Sin esto se usa REFERENCED_MESSAGE.
   */
  referencedMessage?: (refs: readonly { fieldId: string; count: number }[]) => string;
  beforeWrite?: (ctx: WriteContext) => Promise<WritePlan>;
}

const T = TABLES;
const text = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const first = (v: unknown): string | null => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);

export const PROYECTO_MESSAGES = {
  clienteSinSigla: "El cliente elegido no tiene sigla.",
  codigoDuplicado: (codigo: string) => `Ya existe un proyecto con el código «${codigo}».`,
  quitarSigla: "No se puede quitar la sigla de un cliente que tiene proyectos.",
  colisiones: (codigos: string[]) => `No se puede cambiar la sigla: estos códigos de proyecto ya existen: ${codigos.join(", ")}.`,
  sinNombreCorto: (proyectos: string[]) => `No se puede cambiar la sigla: estos proyectos no tienen nombre corto: ${proyectos.join(", ")}.`,
} as const;

/** "2 proyectos", "1 venta"… por link inverso de Clientes. */
const CLIENTE_REFERENCE_NOUNS: Record<string, [singular: string, plural: string]> = {
  [T.clientes.fields.proyectos]: ["proyecto", "proyectos"],
  [T.clientes.fields.ventas]: ["venta", "ventas"],
  [T.clientes.fields.tesoreria]: ["movimiento de Tesorería", "movimientos de Tesorería"],
};

/** "a", "a y b", "a, b y c". */
function joinEs(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
}

export const CLIENTE_MESSAGES = {
  referenciado: (refs: readonly { fieldId: string; count: number }[]) => {
    const parts = refs.map((r) => {
      const [one, many] = CLIENTE_REFERENCE_NOUNS[r.fieldId] ?? ["registro asociado", "registros asociados"];
      return `${r.count} ${r.count === 1 ? one : many}`;
    });
    return `No se puede borrar: tiene ${joinEs(parts)}. Pasalo a Inactivo.`;
  },
} as const;

export function buildCodigo(sigla: string, nombreCorto: string): string {
  return `${sigla.trim()} - ${nombreCorto.trim()}`;
}

const links = {
  clienteActivo: {
    table: "clientes",
    fields: [T.clientes.fields.nombre, T.clientes.fields.sigla, T.clientes.fields.estado],
    label: (f) => (f[T.clientes.fields.sigla] ? `${text(f[T.clientes.fields.sigla])} · ${text(f[T.clientes.fields.nombre])}` : text(f[T.clientes.fields.nombre])),
    allow: (f) => isClienteActivo(f[T.clientes.fields.estado]),
  },
  unidadNegocio: {
    table: "unidadesNegocio",
    fields: [T.unidadesNegocio.fields.nombre],
    label: (f) => text(f[T.unidadesNegocio.fields.nombre]),
  },
  categoria: {
    table: "categorias",
    fields: [T.categorias.fields.nombre, T.categorias.fields.tipo],
    label: (f) => `${text(f[T.categorias.fields.nombre])} (${text(f[T.categorias.fields.tipo]) || "sin tipo"})`,
  },
  usuario: {
    table: "usuarios",
    fields: [T.usuarios.fields.nombre, T.usuarios.fields.rol],
    label: (f) => text(f[T.usuarios.fields.nombre]),
    // "Empleados asignados": solo se muestran los usuarios con Rol Empleado (un Admin puede conservar asignaciones viejas).
    show: (f) => f[T.usuarios.fields.rol] === "Empleado",
  },
} satisfies Record<string, LinkSource>;

const P = T.proyectos.fields;
const C = T.clientes.fields;

/** Proyectos: el Código lo arma el servidor (nunca se acepta del cliente) y es único. */
async function proyectosBeforeWrite(ctx: WriteContext): Promise<WritePlan> {
  const clienteId = first(ctx.values.cliente);
  const nombreCorto = text(ctx.values.nombreCorto);
  if (!clienteId || !nombreCorto) return {};
  const cliente = await getAirtableClient().get(T.clientes.id, clienteId, { fields: [C.sigla] });
  const sigla = text(cliente?.fields[C.sigla]).trim();
  if (!sigla) return { invalid: { cliente: PROYECTO_MESSAGES.clienteSinSigla } };

  const codigo = buildCodigo(sigla, nombreCorto);
  const proyectos = await getAirtableClient().list(T.proyectos.id, { fields: [P.codigo] });
  const taken = proyectos.some((p) => p.id !== ctx.id && normalizeForUnique(p.fields[P.codigo]) === normalizeForUnique(codigo));
  if (taken) {
    return { conflict: { error: PROYECTO_MESSAGES.codigoDuplicado(codigo), fieldErrors: { nombreCorto: PROYECTO_MESSAGES.codigoDuplicado(codigo) } } };
  }
  return { extraFields: { [P.codigo]: codigo } };
}

/** Proyectos cuyo Código choca: con otros proyectos (fuera de `mine`) o entre sí. */
function collisionsOf(all: { id: string; fields: Fields }[], mine: Set<string>, updates: { id: string; codigo: string }[]): string[] {
  const others = new Set(all.filter((p) => !mine.has(p.id)).map((p) => normalizeForUnique(p.fields[P.codigo])));
  const seen = new Set<string>();
  const collisions: string[] = [];
  for (const u of updates) {
    const key = normalizeForUnique(u.codigo);
    if (others.has(key) || seen.has(key)) collisions.push(u.codigo);
    seen.add(key);
  }
  return collisions;
}

/**
 * Clientes: si cambia la sigla de un cliente con proyectos, se recalcula el
 * Código de todos sus proyectos. Todo se valida ANTES de escribir: Códigos
 * nuevos únicos (contra todos los proyectos que no se renombran y entre sí),
 * proyectos con nombre corto y payloads escribibles. Cualquier problema
 * rechaza el cambio entero sin escribir nada. Los updates de proyectos llevan
 * su Código original para el rollback.
 */
async function clientesBeforeWrite(ctx: WriteContext): Promise<WritePlan> {
  if (ctx.mode !== "edit" || !ctx.existing || !ctx.id) return {};
  const oldSigla = text(ctx.existing[C.sigla]).trim();
  const newSigla = text(ctx.values.sigla).trim();
  if (oldSigla === newSigla) return {};
  const projectIds = (ctx.existing[C.proyectos] as string[] | undefined) ?? [];
  if (projectIds.length === 0) return {};
  if (!newSigla) return { invalid: { sigla: PROYECTO_MESSAGES.quitarSigla } };

  const all = await getAirtableClient().list(T.proyectos.id, { fields: [P.codigo, P.nombreCorto] });
  const mine = new Set(projectIds);
  const own = all.filter((p) => mine.has(p.id));
  const sinNombre = own.filter((p) => !text(p.fields[P.nombreCorto]).trim());
  if (sinNombre.length > 0) {
    return { conflict: { error: PROYECTO_MESSAGES.sinNombreCorto(sinNombre.map((p) => text(p.fields[P.codigo]) || p.id)) } };
  }
  const updates = own.map((p) => ({ id: p.id, codigo: buildCodigo(newSigla, text(p.fields[P.nombreCorto])), previous: p.fields[P.codigo] }));
  const collisions = collisionsOf(all, mine, updates);
  if (collisions.length > 0) return { conflict: { error: PROYECTO_MESSAGES.colisiones(collisions), fieldErrors: { sigla: PROYECTO_MESSAGES.colisiones(collisions) } } };

  return {
    related: updates.map((u) => ({
      table: "proyectos",
      id: u.id,
      fields: { [P.codigo]: u.codigo },
      previous: { [P.codigo]: typeof u.previous === "string" ? u.previous : null },
    })),
    // Carrera: otro proyecto pudo tomar uno de los Códigos nuevos mientras se escribía.
    verify: async () => {
      const now = await getAirtableClient().list(T.proyectos.id, { fields: [P.codigo] });
      // Un proyecto renombrado que no aparece: no se puede verificar (deshacer → 503).
      const seen = new Set(now.map((p) => p.id));
      const missing = updates.find((u) => !seen.has(u.id));
      if (missing) throw new WrittenRecordMissingError(missing.id);
      const found = collisionsOf(now, mine, updates);
      return found.length > 0 ? { error: PROYECTO_MESSAGES.colisiones(found) } : null;
    },
  };
}

export const MAESTRO_CONFIGS: Record<MaestroSlug, MaestroConfig> = {
  clientes: {
    spec: MAESTRO_SPECS.clientes,
    table: "clientes",
    fieldIds: {
      nombre: C.nombre,
      estado: C.estado,
      sigla: C.sigla,
      cuit: C.cuit,
      condicionIva: C.condicionIva,
      contacto: C.contacto,
      telefono: C.telefono,
      mail: C.mail,
      observaciones: C.observaciones,
    },
    // CUIT opcional; si viene, lib/cuit lo valida y normaliza (11 dígitos) y es único (como en Proveedores).
    unique: ["nombre", "sigla", "cuit"],
    references: REFERENCE_FIELDS.clientes,
    referencedMessage: CLIENTE_MESSAGES.referenciado,
    beforeWrite: clientesBeforeWrite,
  },

  proyectos: {
    spec: MAESTRO_SPECS.proyectos,
    table: "proyectos",
    fieldIds: {
      codigo: P.codigo,
      nombreCorto: P.nombreCorto,
      cliente: P.cliente,
      unidadNegocio: P.unidadNegocio,
      monedaValorHora: P.monedaValorHora,
      valorHora: P.valorHora,
      estado: P.estado,
      descripcion: P.descripcion,
      usuarios: P.usuarios,
    },
    // Código: único; lo arma beforeWrite y se verifica después de escribir.
    unique: ["codigo"],
    links: { cliente: links.clienteActivo, unidadNegocio: links.unidadNegocio, usuarios: links.usuario },
    references: REFERENCE_FIELDS.proyectos,
    beforeWrite: proyectosBeforeWrite,
  },

  proveedores: {
    spec: MAESTRO_SPECS.proveedores,
    table: "proveedores",
    fieldIds: {
      nombre: T.proveedores.fields.nombre,
      cuit: T.proveedores.fields.cuit,
      condicionIva: T.proveedores.fields.condicionIva,
      contacto: T.proveedores.fields.contacto,
      telefono: T.proveedores.fields.telefono,
      mail: T.proveedores.fields.mail,
      categoriaPorDefecto: T.proveedores.fields.categoriaPorDefecto,
      observaciones: T.proveedores.fields.observaciones,
    },
    unique: ["cuit"],
    links: { categoriaPorDefecto: { ...links.categoria, allow: (f) => f[T.categorias.fields.tipo] === "Gasto" } },
    references: REFERENCE_FIELDS.proveedores,
  },

  socios: {
    spec: MAESTRO_SPECS.socios,
    table: "socios",
    fieldIds: { sigla: T.socios.fields.sigla, nombre: T.socios.fields.nombre, porcentajeRetiros: T.socios.fields.porcentajeRetiros },
    unique: ["sigla"],
    references: REFERENCE_FIELDS.socios,
  },

  cuentas: {
    spec: MAESTRO_SPECS.cuentas,
    table: "cuentas",
    fieldIds: {
      nombre: T.cuentas.fields.nombre,
      moneda: T.cuentas.fields.moneda,
      banco: T.cuentas.fields.banco,
      cbu: T.cuentas.fields.cbu,
      saldoInicial: T.cuentas.fields.saldoInicial,
      fechaSaldoInicial: T.cuentas.fields.fechaSaldoInicial,
    },
    unique: ["nombre"],
    references: REFERENCE_FIELDS.cuentas,
  },

  categorias: {
    spec: MAESTRO_SPECS.categorias,
    table: "categorias",
    fieldIds: { nombre: T.categorias.fields.nombre, tipo: T.categorias.fields.tipo, requiereProyecto: T.categorias.fields.requiereProyecto },
    unique: ["nombre"],
    references: REFERENCE_FIELDS.categorias,
  },

  "unidades-de-negocio": {
    spec: MAESTRO_SPECS["unidades-de-negocio"],
    table: "unidadesNegocio",
    fieldIds: { nombre: T.unidadesNegocio.fields.nombre },
    unique: ["nombre"],
    references: REFERENCE_FIELDS.unidadesNegocio,
  },

  "tipos-de-operacion": {
    spec: MAESTRO_SPECS["tipos-de-operacion"],
    table: "tiposOperacion",
    fieldIds: {
      nombre: T.tiposOperacion.fields.nombre,
      movimiento: T.tiposOperacion.fields.movimiento,
      sumaAResultados: T.tiposOperacion.fields.sumaAResultados,
      categoriaPorDefecto: T.tiposOperacion.fields.categoriaPorDefecto,
      pideClienteProveedor: T.tiposOperacion.fields.pideClienteProveedor,
      esDeSocio: T.tiposOperacion.fields.esDeSocio,
    },
    unique: ["nombre"],
    links: { categoriaPorDefecto: links.categoria },
    references: REFERENCE_FIELDS.tiposOperacion,
  },

  "tipos-de-comprobante": {
    spec: MAESTRO_SPECS["tipos-de-comprobante"],
    table: "tiposComprobante",
    fieldIds: {
      codigo: T.tiposComprobante.fields.codigo,
      descripcion: T.tiposComprobante.fields.descripcion,
      signo: T.tiposComprobante.fields.signo,
    },
    unique: ["codigo"],
    references: REFERENCE_FIELDS.tiposComprobante,
  },

  parametros: {
    spec: MAESTRO_SPECS.parametros,
    table: "parametros",
    fieldIds: { concepto: T.parametros.fields.concepto, valor: T.parametros.fields.valor, descripcion: T.parametros.fields.descripcion },
    unique: ["concepto"],
    references: REFERENCE_FIELDS.parametros,
  },
};
