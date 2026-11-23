/**
 * Padrón de ARCA (F5-05 · CC-F5-18): respuesta de getPersona_v2 (ws_sr_constancia_inscripcion)
 * → los datos del cliente para el formulario de Clientes. Funciones puras, client-safe (sin IDs
 * ni secretos): el formulario usa los tipos y los textos; el servidor hace el mapeo.
 *
 * Forma observada en prod (CC-F5-17): `{ personaReturn: { datosGenerales, datosRegimenGeneral,
 * datosMonotributo?, errorConstancia?, errorRegimenGeneral?, errorMonotributo?, metadata } }`.
 * Como en WSFE, un elemento único de una lista puede venir como objeto o como array.
 */

export type CondicionIvaPadron = "Responsable Inscripto" | "Monotributista";

export interface PadronDatos {
  razonSocial: string | null;
  domicilio: string | null;
  condicionIva: CondicionIvaPadron | null;
  avisos: string[];
}

export type PadronMapeo = { found: false } | ({ found: true } & PadronDatos);

/** Lo que recibe el formulario: si se puede consultar y, si no, por qué. */
export interface PadronStatus {
  configured: boolean;
  motivo: string | null;
}

export const PADRON_REQUEST_KEYS = ["cuit"] as const;

export const PADRON_MESSAGES = {
  boton: "Traer datos de ARCA",
  consultando: "Consultando ARCA…",
  formato: "Pedido inválido.",
  noEncontrada: "La CUIT no figura en el padrón de ARCA.",
  ivaIndeterminada: "No pudimos determinar la condición frente al IVA; completala a mano.",
  ivaAmbigua: "ARCA informa régimen general y monotributo a la vez; completá la condición frente al IVA a mano.",
  sinEstado: "ARCA no informó el estado de la CUIT.",
  estado: (estado: string) => `La CUIT figura en ARCA con estado «${estado}».`,
  rechazo: "ARCA rechazó la consulta al padrón. Probá de nuevo más tarde.",
  cuitInvalida: "Ingresá una CUIT válida para consultar ARCA.",
  sinToken: "La integración con ARCA no está configurada (falta el token de Afip SDK).",
  sinCertificado: "Falta el certificado o la clave de ARCA, o no son válidos.",
  sinCuitEmpresa: "Cargá una CUIT válida en Parámetros «CUIT».",
  sinParametros: "No pudimos leer Parámetros; recargá la página.",
  sinCambios: "ARCA no devolvió datos nuevos para este cliente.",
  completados: "Datos traídos de ARCA. Revisalos y tocá Guardar para guardarlos.",
} as const;

/** Largo máximo de cada aviso, incluido el «…». */
export const PADRON_AVISO_MAX = 300;
/** Cuántos textos de error de ARCA se muestran como máximo. */
export const PADRON_ERRORES_MAX = 5;
/** Largo máximo de un dato (razón social, domicilio). */
export const PADRON_DATO_MAX = 300;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
const firstObj = (v: unknown): Obj | null => (list(v).find(isObj) as Obj | undefined) ?? null;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Sin caracteres de control, espacios simples, acotado (con «…»). */
export function limpiarTexto(value: unknown, max: number = PADRON_DATO_MAX): string | null {
  const raw = typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
  if (raw === null) return null;
  const clean = raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** personaReturn (en el body, en `data` o en `response`), o null. */
export function personaDe(body: unknown): Obj | null {
  if (!isObj(body)) return null;
  for (const c of [body, body.data, body.response]) if (isObj(c) && "personaReturn" in c) return firstObj(c.personaReturn);
  return null;
}

/** JURIDICA → razonSocial; si no (FISICA) → «apellido nombre». */
export function razonSocialDe(dg: Obj | null): string | null {
  if (!dg) return null;
  if (limpiarTexto(dg.tipoPersona) === "JURIDICA") return limpiarTexto(dg.razonSocial);
  const partes = [limpiarTexto(dg.apellido), limpiarTexto(dg.nombre)].filter((p): p is string => p !== null);
  return limpiarTexto(partes.join(" "));
}

/** domicilioFiscal → «<direccion> - <localidad>, <descripcionProvincia>» (+ « - <datoAdicional>»), sin código postal. */
export function domicilioDe(dg: Obj | null): string | null {
  const d = dg ? firstObj(dg.domicilioFiscal) : null;
  if (!d) return null;
  const direccion = limpiarTexto(d.direccion);
  const lugar = [limpiarTexto(d.localidad), limpiarTexto(d.descripcionProvincia)].filter((p): p is string => p !== null).join(", ");
  const partes = [direccion, lugar || null, limpiarTexto(d.datoAdicional)].filter((p): p is string => p !== null);
  return limpiarTexto(partes.join(" - "));
}

/** RI: impuesto 30 en estado "AC" en régimen general. Monotributista: datosMonotributo presente. Nunca otra cosa. */
export function condicionIvaDe(persona: Obj): { condicion: CondicionIvaPadron | null; aviso: string | null } {
  const rg = firstObj(persona.datosRegimenGeneral);
  const ri = list(rg?.impuesto).some((i) => isObj(i) && num(i.idImpuesto) === 30 && limpiarTexto(i.estadoImpuesto) === "AC");
  const mono = persona.datosMonotributo !== undefined && persona.datosMonotributo !== null;
  if (ri && mono) return { condicion: null, aviso: PADRON_MESSAGES.ivaAmbigua };
  if (ri) return { condicion: "Responsable Inscripto", aviso: null };
  if (mono) return { condicion: "Monotributista", aviso: null };
  return { condicion: null, aviso: PADRON_MESSAGES.ivaIndeterminada };
}

const BLOQUES_ERROR = [
  ["errorConstancia", "constancia"],
  ["errorRegimenGeneral", "régimen general"],
  ["errorMonotributo", "monotributo"],
] as const;

/** Textos de error de los bloques error* (cada uno `{ error: string | string[] }`), saneados. */
export function erroresDe(persona: Obj): string[] {
  const out: string[] = [];
  for (const [key, nombre] of BLOQUES_ERROR) {
    const bloque = persona[key];
    if (bloque === undefined || bloque === null) continue;
    const textos = list(bloque)
      .flatMap((b) => (isObj(b) ? list(b.error ?? b.mensaje) : [b]))
      .map((t) => limpiarTexto(t, PADRON_AVISO_MAX - nombre.length - 10))
      .filter((t): t is string => t !== null);
    if (textos.length === 0) out.push(`ARCA (${nombre}) informó un error sin detalle.`);
    for (const t of textos) out.push(`ARCA (${nombre}): ${t}`);
  }
  return [...new Set(out)].slice(0, PADRON_ERRORES_MAX).map((t) => limpiarTexto(t, PADRON_AVISO_MAX)!);
}

/** Respuesta de getPersona_v2 → datos del cliente, o `found: false` (no figura). */
export function mapPersona(body: unknown): PadronMapeo {
  const persona = personaDe(body);
  if (!persona) return { found: false };
  const dg = firstObj(persona.datosGenerales);
  const errores = erroresDe(persona);
  if (!dg && errores.length === 0 && !firstObj(persona.datosRegimenGeneral) && persona.datosMonotributo == null) return { found: false };

  const avisos: string[] = [];
  if (dg) {
    const estado = limpiarTexto(dg.estadoClave, 60);
    if (estado === null) avisos.push(PADRON_MESSAGES.sinEstado);
    else if (estado !== "ACTIVO") avisos.push(PADRON_MESSAGES.estado(estado));
  }
  avisos.push(...errores);
  const iva = condicionIvaDe(persona);
  if (iva.aviso) avisos.push(iva.aviso);

  return { found: true, razonSocial: razonSocialDe(dg), domicilio: domicilioDe(dg), condicionIva: iva.condicion, avisos };
}
