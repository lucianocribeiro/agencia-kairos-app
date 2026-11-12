import "server-only";

/**
 * Helpers para armar `filterByFormula` de forma segura.
 *
 * - Los campos se referencian siempre por ID: `{fldXXXXXXXXXXXXXX}`.
 * - Todo valor interpolado se escapa (comillas y barras invertidas), así
 *   que el input del usuario nunca puede cerrar el string ni inyectar fórmula.
 *
 * Uso:
 *   formula`AND(${field(F.email)} = ${email}, ${field(F.estado)} = "Activo")`
 *   eq(F.email, email)
 *   and(eq(F.estado, "Activo"), eq(F.rol, "Admin"))
 */

const FIELD_ID_RE = /^fld[A-Za-z0-9]{14}$/;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;

/** Fragmento de fórmula ya seguro (no se vuelve a escapar). */
export class Formula {
  readonly #source: string;
  constructor(source: string) {
    this.#source = source;
  }
  toString(): string {
    return this.#source;
  }
}

export type FormulaValue = Formula | string | number | boolean | null;

/** Escapa un string para usarlo dentro de comillas dobles en una fórmula de Airtable. */
export function escapeFormulaString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

/** Referencia a un campo por ID: `{fldXXX}`. Lanza si no es un ID de campo. */
export function field(fieldId: string): Formula {
  if (!FIELD_ID_RE.test(fieldId)) {
    throw new TypeError(`ID de campo inválido en fórmula: ${JSON.stringify(fieldId)}`);
  }
  return new Formula(`{${fieldId}}`);
}

/** Convierte un valor a literal de fórmula. */
export function literal(value: FormulaValue): Formula {
  if (value instanceof Formula) return value;
  if (value === null) return new Formula("BLANK()");
  if (typeof value === "boolean") return new Formula(value ? "TRUE()" : "FALSE()");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Número no finito en fórmula");
    return new Formula(String(value));
  }
  if (typeof value === "string") return new Formula(`"${escapeFormulaString(value)}"`);
  throw new TypeError("Valor no soportado en fórmula");
}

/** Template tag: escapa automáticamente cada valor interpolado. */
export function formula(strings: TemplateStringsArray, ...values: FormulaValue[]): Formula {
  let out = strings[0];
  values.forEach((value, i) => {
    out += literal(value).toString() + strings[i + 1];
  });
  return new Formula(out);
}

export function eq(fieldId: string, value: FormulaValue): Formula {
  return formula`${field(fieldId)} = ${value}`;
}

export function and(...parts: Formula[]): Formula {
  return new Formula(`AND(${parts.join(", ")})`);
}

export function or(...parts: Formula[]): Formula {
  return new Formula(`OR(${parts.join(", ")})`);
}

/** Filtro por ID de registro. */
export function recordIdIs(recordId: string): Formula {
  if (!RECORD_ID_RE.test(recordId)) {
    throw new TypeError(`ID de registro inválido: ${JSON.stringify(recordId)}`);
  }
  return formula`RECORD_ID() = ${recordId}`;
}
