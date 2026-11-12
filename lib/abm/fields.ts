/**
 * Campos de los ABM (Usuarios y Maestros): tipos, parseo y validación.
 *
 * Client-safe y sin IDs de Airtable: lo usan el servidor (fuente de verdad, en
 * lib/abm/server) y los formularios (para mostrar errores antes de enviar). Los
 * mismos specs y las mismas funciones corren en los dos lados.
 */
import { formatCuit, parseCuit } from "@/lib/cuit";
import { displayDateToIso, formatNumber, isoToDisplayDate, parseNumberInput } from "@/lib/format";

export type FieldKind =
  | "text"
  | "multiline"
  | "email"
  | "phone"
  | "select"
  | "checkbox"
  | "number"
  | "integer"
  | "percent"
  | "date"
  | "cuit"
  | "link"
  /** Solo se muestra (lo calcula el servidor o viene de un link inverso). Nunca se acepta del cliente. */
  | "readonly";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** select */
  options?: readonly string[];
  /** integer con valores permitidos (p. ej. Signo: 1 o -1) */
  numberOptions?: readonly number[];
  /** link: multi-select (si no, single-select; se guarda igual como array de 1) */
  multiple?: boolean;
  uppercase?: boolean;
  lowercase?: boolean;
  pattern?: { regex: RegExp; message: string };
  min?: number;
  max?: number;
  /** Al editar se muestra pero no se puede cambiar (y el servidor lo ignora). */
  lockedOnEdit?: boolean;
  /** No va en el formulario (solo en la tabla). */
  hideInForm?: boolean;
  hint?: string;
  placeholder?: string;
}

/** Valor tal como lo maneja el formulario. */
export type RawValue = string | boolean | string[];
export type RawValues = Record<string, RawValue | undefined>;
/** Valor ya parseado (lo que se guarda, antes de mapear a IDs de campo). */
export type Value = string | number | boolean | string[] | null;
export type Values = Record<string, Value>;
export type FieldErrors = Record<string, string>;
export type Mode = "create" | "edit";

export const FIELD_MESSAGES = {
  required: "Este campo es obligatorio.",
  email: "Ingresá un email válido.",
  number: "Ingresá un número (por ejemplo 1.234,56).",
  integer: "Ingresá un número entero.",
  date: "Ingresá una fecha válida (DD/MM/AAAA).",
  option: "Elegí una opción válida.",
  link: "Elegí una opción válida.",
  linkSingle: "Elegí una sola opción.",
  min: (n: number) => `Tiene que ser mayor o igual a ${formatNumber(n)}.`,
  max: (n: number) => `Tiene que ser menor o igual a ${formatNumber(n)}.`,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;

type Parsed = { value: Value } | { error: string };

function asText(raw: RawValue | undefined): string {
  return typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(",") : raw === true ? "true" : "";
}

/** Parsea y valida un campo. `readonly` nunca llega acá (lo filtra parseValues). */
export function parseField(spec: FieldSpec, raw: RawValue | undefined): Parsed {
  const empty = (): Parsed => (spec.required ? { error: FIELD_MESSAGES.required } : { value: null });

  switch (spec.kind) {
    case "checkbox":
      return { value: raw === true || raw === "true" };

    case "link": {
      const ids = (Array.isArray(raw) ? raw : asText(raw).split(","))
        .map((s) => s.trim())
        .filter(Boolean);
      const unique = [...new Set(ids)];
      if (unique.length === 0) return spec.required ? { error: FIELD_MESSAGES.required } : { value: [] };
      if (unique.some((id) => !RECORD_ID_RE.test(id))) return { error: FIELD_MESSAGES.link };
      if (!spec.multiple && unique.length > 1) return { error: FIELD_MESSAGES.linkSingle };
      return { value: unique };
    }

    case "number":
    case "integer":
    case "percent": {
      const text = asText(raw).trim();
      if (!text) return empty();
      const n = parseNumberInput(text.replace(/%\s*$/, ""));
      if (n === null) return { error: FIELD_MESSAGES.number };
      if (spec.kind === "integer" && !Number.isInteger(n)) return { error: FIELD_MESSAGES.integer };
      if (spec.numberOptions && !spec.numberOptions.includes(n)) return { error: FIELD_MESSAGES.option };
      if (spec.min !== undefined && n < spec.min) return { error: FIELD_MESSAGES.min(spec.min) };
      if (spec.max !== undefined && n > spec.max) return { error: FIELD_MESSAGES.max(spec.max) };
      // percent: se ingresa 0–100 y se guarda como decimal (50 → 0,5)
      return { value: spec.kind === "percent" ? Math.round(n * 1e4) / 1e6 : n };
    }

    case "date": {
      const text = asText(raw).trim();
      if (!text) return empty();
      const iso = displayDateToIso(text);
      return iso ? { value: iso } : { error: FIELD_MESSAGES.date };
    }

    case "cuit": {
      const text = asText(raw).trim();
      if (!text) return empty();
      const parsed = parseCuit(text);
      return "digits" in parsed ? { value: parsed.digits } : { error: parsed.error };
    }

    case "select": {
      const text = asText(raw).trim();
      if (!text) return empty();
      return spec.options?.includes(text) ? { value: text } : { error: FIELD_MESSAGES.option };
    }

    default: {
      // text, multiline, email, phone
      let text = asText(raw).trim();
      if (spec.uppercase) text = text.toUpperCase();
      if (spec.lowercase) text = text.toLowerCase();
      if (!text) return empty();
      if (spec.kind === "email" && !EMAIL_RE.test(text)) return { error: FIELD_MESSAGES.email };
      if (spec.pattern && !spec.pattern.regex.test(text)) return { error: spec.pattern.message };
      return { value: text };
    }
  }
}

/** Campos editables en este modo (sin readonly, sin hideInForm, sin bloqueados al editar). */
export function editableFields(specs: readonly FieldSpec[], mode: Mode): FieldSpec[] {
  return specs.filter((s) => s.kind !== "readonly" && !s.hideInForm && !(mode === "edit" && s.lockedOnEdit));
}

/**
 * Parsea un formulario completo. Ignora cualquier clave que no sea un campo
 * editable (p. ej. un Código mandado por el cliente).
 */
export function parseValues(
  specs: readonly FieldSpec[],
  raw: RawValues,
  mode: Mode,
): { values: Values; errors: FieldErrors } {
  const values: Values = {};
  const errors: FieldErrors = {};
  for (const spec of editableFields(specs, mode)) {
    const result = parseField(spec, raw[spec.key]);
    if ("error" in result) errors[spec.key] = result.error;
    else values[spec.key] = result.value;
  }
  return { values, errors };
}

/** Valor guardado → valor del input. */
export function formatForInput(spec: FieldSpec, value: unknown): RawValue {
  if (spec.kind === "checkbox") return value === true;
  if (spec.kind === "link") return Array.isArray(value) ? value.map(String) : [];
  if (value === null || value === undefined || value === "") return "";
  switch (spec.kind) {
    case "number":
      return typeof value === "number" ? formatNumber(value, { maxDecimals: 6 }).replace(/\./g, "") : String(value);
    case "integer":
      return typeof value === "number" ? String(value) : String(value);
    case "percent":
      return typeof value === "number" ? formatNumber(value * 100, { maxDecimals: 4 }).replace(/\./g, "") : String(value);
    case "date":
      return isoToDisplayDate(String(value));
    case "cuit":
      return formatCuit(String(value));
    default:
      return String(value);
  }
}

/** Valor guardado → texto para la tabla. `labels` resuelve IDs de links. */
export function formatForDisplay(spec: FieldSpec, value: unknown, labels: Record<string, string> = {}): string {
  if (spec.kind === "checkbox") return value === true ? "Sí" : "No";
  if (Array.isArray(value)) return value.map((id) => labels[String(id)] ?? "—").join(", ");
  if (value === null || value === undefined || value === "") return "";
  switch (spec.kind) {
    case "number":
      return typeof value === "number" ? formatNumber(value, { minDecimals: 0, maxDecimals: 2 }) : String(value);
    case "percent":
      return typeof value === "number" ? `${formatNumber(value * 100, { maxDecimals: 2 })} %` : String(value);
    case "date":
      return isoToDisplayDate(String(value));
    case "cuit":
      return formatCuit(String(value));
    default:
      return String(value);
  }
}
