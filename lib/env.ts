import "server-only";

/**
 * Variables de entorno del servidor.
 *
 * La validación es perezosa: no se ejecuta al importar el módulo, sino la
 * primera vez que se llama a `getEnv()`. Así `next build` no falla si las
 * variables no están disponibles en tiempo de build.
 *
 * Ninguna de estas variables lleva el prefijo `NEXT_PUBLIC_`: nunca deben
 * llegar al navegador.
 */

export const REQUIRED_ENV_VARS = [
  "AIRTABLE_TOKEN",
  "AIRTABLE_BASE_ID",
  "SESSION_SECRET",
] as const;

export type EnvVarName = (typeof REQUIRED_ENV_VARS)[number];
export type ServerEnv = Readonly<Record<EnvVarName, string>>;

export class EnvError extends Error {
  readonly missing: readonly EnvVarName[];
  readonly invalid: readonly EnvVarName[];

  constructor(missing: EnvVarName[], invalid: { name: EnvVarName; reason: string }[]) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(`Faltan variables de entorno: ${missing.join(", ")}.`);
    }
    for (const { name, reason } of invalid) {
      parts.push(`${name} no es válida: ${reason}.`);
    }
    parts.push(
      "Revisá .env.local (desarrollo) o las variables del proyecto en Vercel. Ver .env.example.",
    );
    super(parts.join(" "));
    this.name = "EnvError";
    this.missing = missing;
    this.invalid = invalid.map((i) => i.name);
  }
}

const VALIDATORS: Partial<Record<EnvVarName, (value: string) => string | null>> = {
  AIRTABLE_BASE_ID: (v) =>
    /^app[A-Za-z0-9]{14}$/.test(v) ? null : "tiene que ser un ID de base (app + 14 caracteres)",
  SESSION_SECRET: (v) =>
    v.length >= 32 ? null : "tiene que tener al menos 32 caracteres (usá openssl rand -base64 32)",
};

/** Valida un objeto de entorno. Exportada para tests; en la app usá `getEnv()`. */
export function parseEnv(source: Record<string, string | undefined>): ServerEnv {
  const missing: EnvVarName[] = [];
  const invalid: { name: EnvVarName; reason: string }[] = [];
  const result = {} as Record<EnvVarName, string>;

  for (const name of REQUIRED_ENV_VARS) {
    const value = source[name]?.trim();
    if (!value) {
      missing.push(name);
      continue;
    }
    const reason = VALIDATORS[name]?.(value) ?? null;
    if (reason) invalid.push({ name, reason });
    result[name] = value;
  }

  if (missing.length > 0 || invalid.length > 0) {
    throw new EnvError(missing, invalid);
  }
  return Object.freeze(result);
}

let cached: ServerEnv | null = null;

/** Devuelve las variables validadas. Lanza `EnvError` con un mensaje claro si falta alguna. */
export function getEnv(): ServerEnv {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
