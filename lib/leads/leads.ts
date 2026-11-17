/**
 * Leads (CC-F4-06): campos, reglas y mensajes. Client-safe (sin IDs de Airtable): lo usan
 * el formulario y el servidor (lib/leads/server), que es la fuente de verdad.
 */
import { parseValues, type FieldErrors, type FieldSpec, type RawValues, type Values } from "@/lib/abm/fields";

/** Todas las opciones de Tipo en Airtable. «Cliente» solo lo escribe la conversión. */
export const LEAD_TIPOS = ["Cliente", "Lead", "Ex Cliente", "Frío", "Partnership"] as const;
export const LEAD_TIPO_CLIENTE = "Cliente";
/** Tipos que se eligen a mano (alta y edición). */
export const LEAD_TIPOS_ELEGIBLES = LEAD_TIPOS.filter((t) => t !== LEAD_TIPO_CLIENTE);
export const LEAD_STATUS = ["Activo", "Concluido"] as const;
export const LEAD_ORIGENES = ["F&F", "Referidos", "Orgánico"] as const;

export const LEAD_FIELDS: readonly FieldSpec[] = [
  { key: "nombre", label: "Nombre", kind: "text", required: true },
  { key: "tipo", label: "Tipo", kind: "select", options: LEAD_TIPOS_ELEGIBLES, hint: "«Cliente» se asigna solo con «Pasar a cliente»." },
  { key: "status", label: "Status", kind: "select", options: LEAD_STATUS },
  { key: "proyecto", label: "Proyecto", kind: "multiline" },
  { key: "contacto", label: "Contacto", kind: "text" },
  { key: "telefono", label: "Teléfono", kind: "phone" },
  { key: "mail", label: "Mail", kind: "email" },
  { key: "origen", label: "Origen", kind: "select", options: LEAD_ORIGENES },
  { key: "referidoPor", label: "Referido por", kind: "text" },
  { key: "comentarios", label: "Comentarios", kind: "multiline" },
  { key: "ventas", label: "Ventas", kind: "text" },
  { key: "cobranzas", label: "Cobranzas", kind: "text" },
  { key: "ventasSrl", label: "Ventas SRL", kind: "text" },
  { key: "cobranzasSrl", label: "Cobranzas SRL", kind: "text" },
];

/** Claves que acepta la API de alta y edición (los 14 campos; nunca Cliente). */
export const LEAD_INPUT_KEYS: readonly string[] = LEAD_FIELDS.map((f) => f.key);

/** Columnas de la lista, en orden. */
export const LEAD_COLUMNS = ["nombre", "tipo", "status", "contacto", "telefono", "mail", "origen", "referidoPor"] as const;

export const LEAD_MESSAGES = {
  tipoCliente: "«Cliente» no se elige a mano: usá «Pasar a cliente».",
  convertido: "Este lead ya pasó a cliente: no se puede editar ni volver a convertir. Solo se puede eliminar.",
  noEncontrado: "No encontramos el lead. Puede que lo hayan eliminado.",
  validacion: "Revisá los campos marcados.",
  siglaRequerida: "Ingresá la sigla del cliente.",
  carrera: "Otra persona cambió este lead mientras lo pasabas a cliente. No se modificó nada; probá de nuevo.",
  eliminarConfirmacion: "¿Eliminar este lead? No se puede deshacer.",
  convertirConfirmacion: "Este lead pasa al módulo Clientes y no se puede volver a Lead. ¿Querés continuar?",
} as const;

/** Lead como viaja al navegador (solo Admin). `cliente` = el cliente creado por la conversión, si sigue existiendo. */
export interface LeadDTO {
  id: string;
  values: Values;
  cliente: { id: string; nombre: string } | null;
  convertido: boolean;
}

/**
 * Convertido = Tipo «Cliente» o con link a un cliente. Cualquiera de los dos alcanza: así un lead
 * cuyo cliente se borró (el link queda vacío) sigue de solo lectura.
 */
export function esConvertido(tipo: unknown, clienteIds: readonly unknown[]): boolean {
  return tipo === LEAD_TIPO_CLIENTE || clienteIds.length > 0;
}

/** Mismas reglas en el formulario y en el servidor. «Cliente» a mano → error en Tipo. */
export function validateLead(raw: RawValues): { values: Values; errors: FieldErrors } {
  const { values, errors } = parseValues(LEAD_FIELDS, raw, "create");
  if (typeof raw.tipo === "string" && raw.tipo.trim() === LEAD_TIPO_CLIENTE) errors.tipo = LEAD_MESSAGES.tipoCliente;
  return { values, errors };
}
