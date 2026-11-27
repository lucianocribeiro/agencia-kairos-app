/**
 * Factura A electrónica desde la Proforma (CC-F5-10 · F5-03). Puro y client-safe: reglas de
 * elegibilidad, importes, IDs de WSFE, el snapshot que se guarda en «Comprobantes emitidos»
 * y los textos. El servidor (lib/factura/server) lee Airtable y habla con Afip SDK.
 *
 * Reglas fijas:
 * - Solo pesos (MonId PES, MonCotiz 1), solo Factura A a un cliente Responsable Inscripto, una por
 *   cliente + mes + ambiente. Las horas en USD se convierten con el TC que carga el Admin en la
 *   Proforma (CC-F5-21, `convertirAPesos` de lib/proforma/tipo-cambio.ts).
 * - Importes del servidor con las reglas de la proforma (centavos enteros), solo con las horas
 *   facturables en Pendiente. Nunca importes que mande el navegador.
 * - El PDF se arma siempre desde el snapshot (`FacturaDatos`), nunca desde datos actuales.
 */
import { isValidCuit } from "@/lib/cuit";
import { isIsoDate } from "@/lib/horas/dates";
import { formatNumber } from "@/lib/format";
import { leerTipoCambio } from "@/lib/proforma/tipo-cambio";

// ── Constantes de WSFE y de la factura ────────────────────────────────────────

export const TIPO_FACTURA_A = "Factura A";
/** Código de comprobante de ARCA (Tipos de comprobante): 1 = Factura A. */
export const CBTE_TIPO_FACTURA_A = 1;
/** Concepto 2 = Servicios. */
export const CONCEPTO_SERVICIOS = 2;
/** DocTipo 80 = CUIT. */
export const DOC_TIPO_CUIT = 80;
export const CONDICION_VENTA = "Cuenta Corriente";
export const UNIDAD_MEDIDA = "unidades";
export const DETALLE_MAX = 200;
export const CONDICION_IVA_EMISOR = "IVA Responsable Inscripto";

/**
 * Homologación (Afip SDK "dev"): CUIT de prueba de Afip SDK como emisor, sin certificado
 * (docs.afipsdk.com/integracion/api.md). El punto de venta de prueba es siempre 1
 * (docs.afipsdk.com/siguientes-pasos/web-services/factura-electronica.md, «siempre se usa 1»).
 */
export const DEV_CUIT_EMISOR = "20409378472";
export const DEV_PUNTO_VENTA = 1;

export type Ambiente = "Homologación" | "Producción";
export const AMBIENTES: readonly Ambiente[] = ["Homologación", "Producción"];

export const ESTADOS_COMPROBANTE = ["En proceso", "Autorizada", "Rechazada", "Incierta", "Anulada"] as const;
export type EstadoComprobante = (typeof ESTADOS_COMPROBANTE)[number];
/** Estados que ocupan la clave cliente + mes + tipo + ambiente (no se puede emitir otra). */
export const ESTADOS_ACTIVOS: readonly EstadoComprobante[] = ["En proceso", "Incierta", "Autorizada"];

/**
 * Alícuota → Id de IVA de WSFE (FEParamGetTiposIva). Confirmado en el ambiente dev de Afip SDK
 * (CC-F5-10, ver el reporte): 3 = 0 %, 9 = 2,5 %, 8 = 5 %, 4 = 10,5 %, 5 = 21 %, 6 = 27 %.
 * Clave: la alícuota en milésimas (210 = 21 %).
 */
export const IVA_IDS: Readonly<Record<number, number>> = { 0: 3, 25: 9, 50: 8, 105: 4, 210: 5, 270: 6 };

/** Id de IVA de WSFE de una tasa (0,21 → 5) o null si no es una alícuota de WSFE. */
export function ivaIdDe(alicuota: number): number | null {
  const milesimas = Math.round(alicuota * 1000);
  if (Math.abs(alicuota * 1000 - milesimas) > 1e-6) return null;
  return Object.hasOwn(IVA_IDS, milesimas) ? IVA_IDS[milesimas] : null;
}

/**
 * Condición IVA del cliente → CondicionIVAReceptorId (FEParamGetCondicionIvaReceptor, confirmado
 * en dev). Solo Responsable Inscripto: la Factura A es solo para ellos.
 */
export const CONDICION_IVA_RECEPTOR_IDS: Readonly<Record<string, number>> = { "Responsable Inscripto": 1 };

// ── Parámetros ────────────────────────────────────────────────────────────────

export const PARAMS = {
  empresa: "Empresa",
  cuit: "CUIT",
  domicilio: "Domicilio comercial",
  ingresosBrutos: "Ingresos Brutos",
  inicioActividades: "Inicio de actividades",
  puntoVenta: "Punto de venta web services",
  leyenda: "Leyenda factura A",
} as const;

// ── Textos ────────────────────────────────────────────────────────────────────

export const FACTURA_MESSAGES = {
  faltaTipoCambio: "Cargá el tipo de cambio para convertir los importes en USD.",
  incompleta: "Hay proyectos sin valor hora o moneda: completalos antes de facturar.",
  noResponsableInscripto: "La factura A es sólo para clientes Responsable Inscripto.",
  cuitCliente: "Falta la CUIT del cliente o no es válida.",
  razonSocialCliente: "Falta la razón social del cliente.",
  domicilioCliente: "Falta el domicilio comercial del cliente.",
  parametroFalta: (concepto: string) => `Completá el parámetro «${concepto}» en Maestros.`,
  parametroInvalido: (concepto: string, formato: string) => `El parámetro «${concepto}» no es válido (${formato}).`,
  alicuota: "La alícuota de IVA de la proforma no es una alícuota de ARCA (0; 2,5; 5; 10,5; 21 o 27 %).",
  sinPendientes: (mes: string) => `No hay horas facturables pendientes de este cliente en ${mes}.`,
  sinImporte: "Las horas pendientes no suman importe: no hay nada para facturar.",
  yaEmitida: (ambiente: Ambiente, estado: EstadoComprobante) => `Ya hay una factura A de este cliente y mes en ${ambiente} (${estado}).`,
  noConfigurada: "La facturación electrónica no está configurada.",
  prodSinCertificado: "La facturación en Producción no está configurada: falta el certificado o la clave privada, o no son válidos.",
  // Pedido
  formato: "El formato del pedido no es válido.",
  vencimientoPago: "Elegí un vencimiento de pago válido (igual o posterior a hoy).",
  detalle: `Escribí el detalle de la factura (hasta ${DETALLE_MAX} caracteres).`,
  noElegible: "Esta factura no se puede emitir: revisá los requisitos.",
  enParalelo: "Ya se está emitiendo una factura de este cliente y mes. Esperá a que termine.",
  noEncontrado: "No encontramos ese comprobante.",
  // Resultado
  incierta: "No sabemos si ARCA emitió la factura. Usá \"Verificar en ARCA\".",
  faltaRegistro: "Autorizada en ARCA; falta registrar en Ventas.",
  noEmitida: "ARCA no emitió la factura; podés volver a intentar.",
  revisarManual: "Revisar manualmente en ARCA.",
  datosIncompletos: "Revisar manualmente: datos del comprobante incompletos.",
  horasCambiaron: "Cambiaron las horas mientras se emitía; volvé a intentar.",
  noLiberada: "No pudimos liberar la proforma. Usá \"Verificar en ARCA\" en unos minutos para destrabarla.",
  noLlegoArca: "La emisión no llegó a ARCA; podés volver a intentar.",
  horasNoVerificadas: "No pudimos verificar las horas antes de emitir; volvé a intentar.",
  horasFaltantes: (ids: readonly string[]) => `Horas que ya no existen (no se marcaron Facturada): ${ids.slice(0, 20).join(", ")}${ids.length > 20 ? ` y ${ids.length - 20} más` : ""}.`,
  rechazada: "ARCA rechazó la factura.",
  noIncierta: "Solo se puede verificar una factura Incierta.",
  noPendiente: "Esta factura no tiene registros pendientes.",
  sinPdf: "Solo las facturas autorizadas tienen PDF.",
} as const;

// ── Elegibilidad ──────────────────────────────────────────────────────────────

export interface ElegibilidadInput {
  /** Totales de la proforma (todas las horas facturables del mes). */
  monedas: readonly ("ARS" | "USD")[];
  proformaIncompleta: boolean;
  cliente: { condicionIva: string | null; cuit: string | null; razonSocial: string | null; domicilioComercial: string | null };
  /** Concepto → Valor (texto, sin trim). */
  parametros: ReadonlyMap<string, string>;
  alicuota: number;
  /** Horas facturables en Pendiente del cliente + mes (con o sin valor hora). */
  horasPendientes: number;
  /** Neto en pesos (centavos) de las horas pendientes: ARS + USD convertidos si hay TC; sin TC, solo ARS. */
  netoPendiente: number;
  /** TC válido de la Proforma (CC-F5-21), o null. */
  tipoCambio: number | null;
  /** Subtotal USD (centavos) de las horas pendientes; sin TC no se puede convertir. */
  usdPendiente: number;
  /** Comprobante activo (En proceso / Incierta / Autorizada) de la misma clave, si hay. */
  activo: { ambiente: Ambiente; estado: EstadoComprobante } | null;
  /** «mm/aaaa» */
  mesLabel: string;
  /** Configuración del entorno: null = ok, o el mensaje. */
  configError: string | null;
}

const has = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** Punto de venta: entero de 1 a 99999. */
export function parsePuntoVenta(v: string | null | undefined): number | null {
  const s = (v ?? "").trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 99999 ? n : null;
}

/** Fecha AAAA-MM-DD válida. */
export const isFechaIso = (v: string | null | undefined): v is string => isIsoDate((v ?? "").trim());

/** Motivos (es-AR) por los que no se puede emitir; vacío = elegible. */
export function evaluarElegibilidad(i: ElegibilidadInput): string[] {
  const out: string[] = [];
  if (i.configError) out.push(i.configError);
  const faltaTc = i.monedas.includes("USD") && i.tipoCambio === null;
  if (faltaTc) out.push(FACTURA_MESSAGES.faltaTipoCambio);
  if (i.proformaIncompleta) out.push(FACTURA_MESSAGES.incompleta);
  if (i.cliente.condicionIva !== "Responsable Inscripto") out.push(FACTURA_MESSAGES.noResponsableInscripto);
  if (!has(i.cliente.cuit) || !isValidCuit(i.cliente.cuit)) out.push(FACTURA_MESSAGES.cuitCliente);
  if (!has(i.cliente.razonSocial)) out.push(FACTURA_MESSAGES.razonSocialCliente);
  if (!has(i.cliente.domicilioComercial)) out.push(FACTURA_MESSAGES.domicilioCliente);
  const p = (c: string) => i.parametros.get(c)?.trim() ?? "";
  for (const c of [PARAMS.empresa, PARAMS.cuit, PARAMS.domicilio, PARAMS.ingresosBrutos, PARAMS.inicioActividades, PARAMS.puntoVenta]) {
    if (!p(c)) out.push(FACTURA_MESSAGES.parametroFalta(c));
  }
  if (p(PARAMS.cuit) && !isValidCuit(p(PARAMS.cuit))) out.push(FACTURA_MESSAGES.parametroInvalido(PARAMS.cuit, "CUIT de 11 dígitos"));
  if (p(PARAMS.inicioActividades) && !isFechaIso(p(PARAMS.inicioActividades))) out.push(FACTURA_MESSAGES.parametroInvalido(PARAMS.inicioActividades, "AAAA-MM-DD"));
  if (p(PARAMS.puntoVenta) && parsePuntoVenta(p(PARAMS.puntoVenta)) === null) out.push(FACTURA_MESSAGES.parametroInvalido(PARAMS.puntoVenta, "entero de 1 a 99999"));
  if (ivaIdDe(i.alicuota) === null) out.push(FACTURA_MESSAGES.alicuota);
  if (i.horasPendientes === 0) out.push(FACTURA_MESSAGES.sinPendientes(i.mesLabel));
  // Sin TC, la parte en USD todavía no tiene importe en pesos: el motivo es el TC, no «no suman importe».
  else if (i.netoPendiente <= 0 && !(faltaTc && i.usdPendiente > 0)) out.push(FACTURA_MESSAGES.sinImporte);
  if (i.activo) out.push(FACTURA_MESSAGES.yaEmitida(i.activo.ambiente, i.activo.estado));
  return out;
}

// ── Importes y fechas ─────────────────────────────────────────────────────────

/** Centavos → número con 2 decimales para WSFE (12345 → 123.45). */
export const centsToWsfe = (cents: number): number => Math.round(cents) / 100;

/** "AAAA-MM-DD" → 20261031 (número aaaammdd de WSFE). */
export const isoToWsfe = (iso: string): number => Number(iso.replaceAll("-", ""));

/** "20261031" o 20261031 → "2026-10-31"; otra cosa → null. */
export function wsfeToIso(v: unknown): string | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return isIsoDate(iso) ? iso : null;
}

/** Primer y último día de "AAAA-MM". */
export function periodoDelMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(last).padStart(2, "0")}` };
}

// ── Snapshot («Datos») ────────────────────────────────────────────────────────

export interface FacturaDatos {
  version: 1;
  ambiente: Ambiente;
  tipo: typeof TIPO_FACTURA_A;
  cbteTipo: typeof CBTE_TIPO_FACTURA_A;
  emisor: {
    razonSocial: string;
    /** 11 dígitos, la CUIT enviada (en Homologación, la de prueba de Afip SDK). */
    cuit: string;
    domicilioComercial: string;
    condicionIva: typeof CONDICION_IVA_EMISOR;
    ingresosBrutos: string;
    /** AAAA-MM-DD */
    inicioActividades: string;
    leyenda: string | null;
  };
  receptor: {
    clienteId: string;
    razonSocial: string;
    cuit: string;
    condicionIva: string;
    condicionIvaReceptorId: number;
    domicilioComercial: string;
    condicionVenta: typeof CONDICION_VENTA;
  };
  /** "AAAA-MM" */
  mes: string;
  periodoDesde: string;
  periodoHasta: string;
  fechaEmision: string;
  vencimientoPago: string;
  puntoVenta: number;
  numero: number | null;
  detalle: {
    descripcion: string;
    cantidad: 1;
    unidad: typeof UNIDAD_MEDIDA;
    /** Centavos (= neto). */
    precioUnitario: number;
    bonificacion: 0;
    subtotal: number;
    subtotalConIva: number;
  };
  /** Tasa (0,21) e Id de IVA de WSFE. */
  alicuota: number;
  ivaId: number;
  /** Centavos (pesos). */
  importes: { neto: number; iva: number; total: number };
  /**
   * CC-F5-21: TC con que se convirtieron las horas en USD (null = sin parte en USD), el subtotal en USD
   * (centavos) y su equivalente en pesos (centavos, toCents(subtotalUsd / 100 × TC)). Opcionales: los
   * snapshots anteriores no los tienen.
   */
  tipoCambio?: number | null;
  subtotalUsd?: number | null;
  netoArsDesdeUsd?: number | null;
  /** IDs de las horas incluidas (en Homologación quedan solo acá, nunca como link). */
  horas: string[];
  proyectos: string[];
  cae: string | null;
  vencimientoCae: string | null;
}

/** El snapshot guardado → objeto validado; null si no tiene la forma esperada. */
export function parseDatos(text: unknown): FacturaDatos | null {
  if (typeof text !== "string" || text.length > 200_000) return null;
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object") return null;
  const x = d as Partial<FacturaDatos>;
  const ok =
    x.version === 1 &&
    (x.ambiente === "Homologación" || x.ambiente === "Producción") &&
    x.tipo === TIPO_FACTURA_A &&
    typeof x.emisor === "object" &&
    typeof x.receptor === "object" &&
    typeof x.importes === "object" &&
    typeof x.detalle === "object" &&
    typeof x.puntoVenta === "number" &&
    Array.isArray(x.horas);
  return ok ? (x as FacturaDatos) : null;
}

/** El snapshot con una autorización completa (número > 0, CAE de 14 dígitos, vencimiento válido), o null. */
export function autorizacionDelSnapshot(d: FacturaDatos | null): (FacturaDatos & { numero: number; cae: string; vencimientoCae: string }) | null {
  if (!d) return null;
  const ok = typeof d.numero === "number" && Number.isInteger(d.numero) && d.numero > 0 && typeof d.cae === "string" && /^\d{14}$/.test(d.cae) && typeof d.vencimientoCae === "string" && wsfeToIso(d.vencimientoCae) === d.vencimientoCae;
  return ok ? (d as FacturaDatos & { numero: number; cae: string; vencimientoCae: string }) : null;
}

// ── Formatos ──────────────────────────────────────────────────────────────────

export const pv5 = (n: number) => String(n).padStart(5, "0");
export const n8 = (n: number) => String(n).padStart(8, "0");

/** «FA 00001-00000003 · <cliente> · 10/2026 · Homologación» (sin número: «FA 00001-(sin número)»). */
export function comprobanteLabel(d: { puntoVenta: number; numero: number | null; cliente: string; mes: string; ambiente: Ambiente }): string {
  const nro = d.numero === null ? "(sin número)" : n8(d.numero);
  return `FA ${pv5(d.puntoVenta)}-${nro} · ${d.cliente} · ${d.mes.slice(5, 7)}/${d.mes.slice(0, 4)} · ${d.ambiente}`;
}

export const nombreArchivoFactura = (puntoVenta: number, numero: number) => `Factura_A_${pv5(puntoVenta)}-${n8(numero)}.pdf`;

/** 1234567 centavos → «12.345,67» (es-AR). */
export const moneyAr = (cents: number) => formatNumber(cents / 100, { decimals: 2 });

// ── Lo que ve la pantalla (GET /api/admin/facturas) ──────────────────────────

export interface ComprobanteVista {
  id: string;
  label: string;
  estado: EstadoComprobante | null;
  ambiente: Ambiente | null;
  puntoVenta: number | null;
  numero: number | null;
  cae: string | null;
  vencimientoCae: string | null;
  /** Centavos. */
  total: number | null;
  mensaje: string | null;
  pdf: boolean;
  verificable: boolean;
  completable: boolean;
  /** Producción: Autorizada sin registrar en Ventas/Horas (derivado de los datos, no de Mensaje). */
  pendienteRegistro: boolean;
  /** Producción + Autorizada con el snapshot incompleto (CC-F5-12): revisar a mano, sin «Completar registro». */
  datosIncompletos: boolean;
}

export interface FacturaEstado {
  ambiente: Ambiente;
  configurada: boolean;
  elegible: boolean;
  motivos: string[];
  /** AAAA-MM-DD (Buenos Aires): fecha de emisión y mínimo del vencimiento de pago. */
  hoy: string;
  /** Factura (horas Pendiente, en pesos; las USD convertidas con el TC), centavos. */
  importes: { neto: number; iva: number; total: number };
  /** TC con el que se calcularon los importes (CC-F5-21), o null (sin USD o sin TC). */
  tipoCambio: number | null;
  /** Desglose de la conversión de la factura (centavos), solo con TC. */
  conversion: { subtotalArs: number; subtotalUsd: number; netoArsDesdeUsd: number } | null;
  /** Totales de la proforma (todas las horas facturables), centavos. */
  proformaTotales: { moneda: "ARS" | "USD"; subtotal: number; iva: number; total: number }[];
  /** La factura difiere de la proforma (p. ej. horas ya facturadas o en USD). */
  difiere: boolean;
  alicuota: number;
  detalleSugerido: string;
  comprobantes: ComprobanteVista[];
}

// ── Pedido de emisión ─────────────────────────────────────────────────────────

/**
 * Claves del body de emitir. `tipoCambio` (CC-F5-21) es un DATO de entrada (texto es-AR, mismas reglas
 * que la Proforma), nunca un importe: ausente, null o "" = sin TC; otro tipo o inválido → 400. Si la
 * proforma no tiene USD se ignora; si tiene USD y falta, la factura no es elegible (409).
 */
export const EMITIR_KEYS = ["cliente", "mes", "vencimientoPago", "detalle", "tipoCambio"] as const;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export interface EmitirInput {
  cliente: string;
  mes: string;
  vencimientoPago: string;
  detalle: string;
  tipoCambio: number | null;
}

/** Body estricto (solo esas claves) → input; `hoy` = fecha de emisión. */
export function validarEmitir(body: Record<string, unknown>, hoy: string): { ok: true; data: EmitirInput } | { ok: false; error: string } {
  if (!Object.keys(body).every((k) => (EMITIR_KEYS as readonly string[]).includes(k))) return { ok: false, error: FACTURA_MESSAGES.formato };
  const { cliente, mes, vencimientoPago, detalle } = body;
  if (typeof cliente !== "string" || !RECORD_ID_RE.test(cliente)) return { ok: false, error: FACTURA_MESSAGES.formato };
  if (typeof mes !== "string" || !MES_RE.test(mes) || mes < "2000-01" || mes > "2099-12") return { ok: false, error: FACTURA_MESSAGES.formato };
  if (typeof vencimientoPago !== "string" || !isIsoDate(vencimientoPago) || vencimientoPago < hoy) return { ok: false, error: FACTURA_MESSAGES.vencimientoPago };
  const texto = typeof detalle === "string" ? detalle.replace(CONTROL, " ").replace(/\s+/g, " ").trim() : "";
  if (!texto || texto.length > DETALLE_MAX) return { ok: false, error: FACTURA_MESSAGES.detalle };
  const tc = leerTipoCambio(body.tipoCambio);
  if ("error" in tc) return { ok: false, error: tc.error };
  return { ok: true, data: { cliente, mes, vencimientoPago, detalle: texto, tipoCambio: tc.tc } };
}

/** Detalle sugerido: los nombres de los proyectos incluidos, cortado a 200. */
export function detalleSugerido(proyectos: readonly string[], mesLabel: string): string {
  const base = `Servicios ${mesLabel}: ${proyectos.join(", ")}`;
  return base.length > DETALLE_MAX ? `${base.slice(0, DETALLE_MAX - 1)}…` : base;
}

/** Líneas de Errors/Observaciones de ARCA: «<Code>: <Msg>», sin controles, ≤ 300 cada una, como máximo 10. */
export function lineasArca(items: readonly { code: string; msg: string }[]): string[] {
  return items.slice(0, 10).map(({ code, msg }) => {
    const line = `${code}: ${msg}`.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
    return line.length > 300 ? `${line.slice(0, 299)}…` : line;
  });
}
