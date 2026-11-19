import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { field, formula, or, recordIdIs } from "@/lib/airtable/formula";
import { losesUniqueRace } from "@/lib/airtable/integrity";
import { invalidFieldIds } from "@/lib/airtable/payload";
import { TABLES } from "@/lib/airtable/schema";
import { Compensation } from "@/lib/abm/server/compensation";
import { injectFault } from "@/lib/abm/server/fault-injection";
import { isClienteActivo } from "@/lib/abm/cliente-estado";
import type { ServiceResult } from "@/lib/abm/types";
import { AfipSdkError } from "@/lib/arca/server/afipsdk";
import type { SessionUser } from "@/lib/auth/session";
import { normalizeCuit } from "@/lib/cuit";
import { todayInBuenosAires } from "@/lib/horas/dates";
import { estadoEfectivo } from "@/lib/horas/estado";
import { calcularProforma, isMesProforma, mesLabel, PARAM_ALICUOTA, parseAlicuota, PROFORMA_MESSAGES, type HoraP, type Moneda, type ProyectoP, type TotalMoneda } from "@/lib/proforma/proforma";
import { horasDelMesFormula, HORA_FIELDS, PROYECTO_FIELDS } from "@/lib/proforma/server/service";
import { claveArca } from "@/lib/ventas-compras/rules";
import {
  CBTE_TIPO_FACTURA_A,
  centsToWsfe,
  comprobanteLabel,
  CONCEPTO_SERVICIOS,
  CONDICION_IVA_EMISOR,
  CONDICION_IVA_RECEPTOR_IDS,
  CONDICION_VENTA,
  DEV_PUNTO_VENTA,
  detalleSugerido,
  DOC_TIPO_CUIT,
  ESTADOS_ACTIVOS,
  evaluarElegibilidad,
  FACTURA_MESSAGES,
  isoToWsfe,
  ivaIdDe,
  parseDatos,
  parsePuntoVenta,
  PARAMS,
  periodoDelMes,
  TIPO_FACTURA_A,
  UNIDAD_MEDIDA,
  validarEmitir,
  wsfeToIso,
  type Ambiente,
  type ComprobanteVista,
  type EstadoComprobante,
  type FacturaDatos,
  type FacturaEstado,
  autorizacionDelSnapshot,
} from "../factura";
import { getFacturaConfig, type FacturaConfig } from "./config";
import { WsfeClient, type WsfeAuth } from "./wsfe";

/**
 * Factura A electrónica (CC-F5-10). Reglas que no se negocian:
 * - El registro «En proceso» se crea ANTES de cualquier pedido a WSFE; si pierde la carrera
 *   contra otro de la misma clave (cliente + mes + tipo + ambiente), se borra y NUNCA llama a WSFE.
 * - FECAESolicitar se manda UNA vez. Timeout, red, 429/5xx o respuesta ilegible → «Incierta»
 *   (se resuelve con «Verificar en ARCA»). Una factura autorizada nunca se deshace.
 * - Homologación nunca escribe Ventas ni cambia Horas (los IDs de horas quedan solo en el snapshot).
 * - Los logs llevan solo IDs y {kind, status}: nunca bodies, CAE, CUIT ni importes.
 */

const CE = TABLES.comprobantesEmitidos;
const F = CE.fields;
const C = TABLES.clientes.fields;
const H = TABLES.horas.fields;
const PA = TABLES.parametros.fields;
const V = TABLES.ventas.fields;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
/** Un «En proceso» más viejo que esto quedó colgado (el proceso murió): se puede verificar como uno Incierto. */
export const EN_PROCESO_COLGADO_MS = 5 * 60 * 1000;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const first = (v: unknown): string | null => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const moneda = (x: unknown): Moneda | null => (x === "ARS" || x === "USD" ? x : null);
const fail = <T>(status: 400 | 404 | 409 | 500 | 503, error: string): ServiceResult<T> => ({ ok: false, status, error });

export const CLIENTE_FACTURA_FIELDS = [C.nombre, C.sigla, C.estado, C.cuit, C.condicionIva, C.razonSocial, C.domicilioComercial];
export const COMPROBANTE_FIELDS = [
  F.comprobante, F.tipo, F.ambiente, F.estado, F.cliente, F.mes, F.usuario, F.puntoVenta, F.numero, F.cae, F.vencimientoCae,
  F.fechaEmision, F.vencimientoPago, F.neto, F.iva, F.total, F.alicuota, F.horas, F.venta, F.datos, F.mensaje, F.iniciado, F.finalizado,
];

// ── Lectura de Comprobantes emitidos ─────────────────────────────────────────

export interface ComprobanteRow {
  id: string;
  createdTime: string;
  label: string;
  tipo: string;
  ambiente: Ambiente | null;
  estado: EstadoComprobante | null;
  cliente: string | null;
  /** "AAAA-MM" */
  mes: string | null;
  puntoVenta: number | null;
  numero: number | null;
  cae: string | null;
  vencimientoCae: string | null;
  total: number | null;
  venta: string | null;
  horas: string[];
  datos: FacturaDatos | null;
  mensaje: string | null;
  iniciado: string | null;
}

function toRow(r: { id: string; createdTime: string; fields: Record<string, unknown> }): ComprobanteRow {
  const f = r.fields;
  const amb = f[F.ambiente];
  const est = f[F.estado];
  return {
    id: r.id,
    createdTime: r.createdTime,
    label: text(f[F.comprobante]),
    tipo: text(f[F.tipo]),
    ambiente: amb === "Homologación" || amb === "Producción" ? amb : null,
    estado: (CE.choices.estado as readonly string[]).includes(est as string) ? (est as EstadoComprobante) : null,
    cliente: first(f[F.cliente]),
    mes: typeof f[F.mes] === "string" ? (f[F.mes] as string).slice(0, 7) : null,
    puntoVenta: num(f[F.puntoVenta]),
    numero: num(f[F.numero]),
    cae: text(f[F.cae]) || null,
    vencimientoCae: text(f[F.vencimientoCae]) || null,
    total: num(f[F.total]),
    venta: first(f[F.venta]),
    horas: Array.isArray(f[F.horas]) ? (f[F.horas] as string[]) : [],
    datos: parseDatos(f[F.datos]),
    mensaje: text(f[F.mensaje]) || null,
    iniciado: text(f[F.iniciado]) || null,
  };
}

/** Comprobantes de un cliente + mes (la tabla es chica: se filtra en código también). */
async function comprobantesDe(cliente: string, mes: string): Promise<ComprobanteRow[]> {
  const rows = await getAirtableClient().list(CE.id, { fields: COMPROBANTE_FIELDS });
  return rows
    .map(toRow)
    .filter((r) => r.cliente === cliente && r.mes === mes)
    .sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id));
}

async function leerComprobante(id: string): Promise<ComprobanteRow | null> {
  if (!RECORD_ID_RE.test(id)) return null;
  const r = await getAirtableClient().get(CE.id, id, { fields: COMPROBANTE_FIELDS });
  return r ? toRow(r) : null;
}

const esActivo = (r: ComprobanteRow, ambiente: Ambiente) => r.tipo === TIPO_FACTURA_A && r.ambiente === ambiente && r.estado !== null && ESTADOS_ACTIVOS.includes(r.estado);

// ── Contexto: cliente, parámetros, proforma y factura ────────────────────────

interface Contexto {
  cliente: { id: string; nombre: string; cuit: string; condicionIva: string | null; razonSocial: string; domicilioComercial: string };
  parametros: Map<string, string>;
  alicuota: number;
  mes: string;
  mesLabel: string;
  proformaTotales: TotalMoneda[];
  /** Factura (solo horas Pendiente, ARS), centavos. */
  importes: { neto: number; iva: number; total: number };
  horas: string[];
  proyectos: { id: string; codigo: string }[];
  comprobantes: ComprobanteRow[];
  motivos: string[];
}

async function cargarContexto(clienteId: string, mes: string, config: FacturaConfigLike): Promise<ServiceResult<Contexto>> {
  if (!RECORD_ID_RE.test(clienteId)) return fail(404, PROFORMA_MESSAGES.clienteInexistente);
  if (!isMesProforma(mes)) return fail(400, PROFORMA_MESSAGES.mes);
  const client = getAirtableClient();
  const [cliente, parametros] = await Promise.all([
    client.get(TABLES.clientes.id, clienteId, { fields: CLIENTE_FACTURA_FIELDS }),
    client.list(TABLES.parametros.id, { fields: [PA.concepto, PA.valor] }),
  ]);
  if (!cliente) return fail(404, PROFORMA_MESSAGES.clienteInexistente);
  if (!isClienteActivo(cliente.fields[C.estado])) return fail(400, PROFORMA_MESSAGES.clienteInactivo);
  const params = new Map<string, string>();
  for (const r of parametros) {
    const k = text(r.fields[PA.concepto]);
    if (k && !params.has(k)) params.set(k, typeof r.fields[PA.valor] === "string" ? (r.fields[PA.valor] as string) : "");
  }
  const alicuota = parseAlicuota(params.get(PARAM_ALICUOTA));
  if (alicuota === null) return fail(409, PROFORMA_MESSAGES.alicuota);

  const [proyectos, horas, comprobantes] = await Promise.all([
    client.list(TABLES.proyectos.id, { fields: PROYECTO_FIELDS }),
    client.list(TABLES.horas.id, { fields: [...HORA_FIELDS, H.estadoFacturacion], filterByFormula: horasDelMesFormula(mes) }),
    comprobantesDe(clienteId, mes),
  ]);
  const P = TABLES.proyectos.fields;
  const proyectosP: ProyectoP[] = proyectos.map((r) => ({
    id: r.id,
    codigo: text(r.fields[P.codigo]) || "(sin código)",
    cliente: first(r.fields[P.cliente]),
    valorHora: num(r.fields[P.valorHora]),
    moneda: moneda(r.fields[P.monedaValorHora]),
  }));
  const horasP: (HoraP & { pendiente: boolean })[] = horas.map((r) => ({
    id: r.id,
    fecha: typeof r.fields[H.fecha] === "string" ? (r.fields[H.fecha] as string) : null,
    colaborador: first(r.fields[H.colaborador]),
    proyecto: first(r.fields[H.proyecto]),
    tarea: text(r.fields[H.tarea]),
    desde: num(r.fields[H.horaDesde]),
    hasta: num(r.fields[H.horaHasta]),
    facturable: r.fields[H.facturable] === true,
    mesAFacturar: typeof r.fields[H.mesAFacturar] === "string" ? (r.fields[H.mesAFacturar] as string) : null,
    pendiente: estadoEfectivo(r.fields[H.estadoFacturacion]) === "Pendiente",
  }));
  const clienteP = {
    id: cliente.id,
    nombre: text(cliente.fields[C.nombre]) || "(sin nombre)",
    sigla: text(cliente.fields[C.sigla]),
    cuit: text(cliente.fields[C.cuit]) || null,
    condicionIva: text(cliente.fields[C.condicionIva]) || null,
  };
  const base = { cliente: clienteP, mes, alicuota, proyectos: proyectosP, colaboradores: new Map<string, string>() };
  const proforma = calcularProforma({ ...base, horas: horasP });
  const pendiente = calcularProforma({ ...base, horas: horasP.filter((h) => h.pendiente) });
  const ars = pendiente.totales.find((t) => t.moneda === "ARS");
  const incluidas = pendiente.detalle.filter((d) => d.moneda === "ARS" && d.importe !== null);
  const importes = ars ? { neto: ars.subtotal, iva: ars.iva, total: ars.total } : { neto: 0, iva: 0, total: 0 };
  const proyectosIncluidos = pendiente.proyectos.filter((p) => p.moneda === "ARS" && p.importe !== null).map((p) => ({ id: p.id, codigo: p.codigo }));

  const activo = comprobantes.find((r) => esActivo(r, config.ambiente)) ?? null;
  const cuitCliente = text(cliente.fields[C.cuit]);
  const motivos = evaluarElegibilidad({
    monedas: proforma.totales.map((t) => t.moneda),
    proformaIncompleta: proforma.incompleta,
    cliente: {
      condicionIva: clienteP.condicionIva,
      cuit: cuitCliente || null,
      razonSocial: text(cliente.fields[C.razonSocial]) || null,
      domicilioComercial: text(cliente.fields[C.domicilioComercial]) || null,
    },
    parametros: params,
    alicuota,
    horasPendientes: pendiente.detalle.length,
    netoPendiente: importes.neto,
    activo: activo ? { ambiente: activo.ambiente!, estado: activo.estado! } : null,
    mesLabel: mesLabel(mes),
    configError: config.error,
  });
  return {
    ok: true,
    data: {
      cliente: {
        id: cliente.id,
        nombre: clienteP.nombre,
        cuit: normalizeCuit(cuitCliente),
        condicionIva: clienteP.condicionIva,
        razonSocial: text(cliente.fields[C.razonSocial]),
        domicilioComercial: text(cliente.fields[C.domicilioComercial]),
      },
      parametros: params,
      alicuota,
      mes,
      mesLabel: mesLabel(mes),
      proformaTotales: proforma.totales,
      importes,
      horas: incluidas.map((d) => d.id),
      proyectos: proyectosIncluidos,
      comprobantes,
      motivos,
    },
  };
}

interface FacturaConfigLike {
  ambiente: Ambiente;
  error: string | null;
}

const configLike = (): FacturaConfigLike => {
  const c = getFacturaConfig();
  return c.ok ? { ambiente: c.config.ambiente, error: null } : { ambiente: c.ambiente, error: c.error };
};

// ── Estado para la pantalla ──────────────────────────────────────────────────

const colgado = (r: ComprobanteRow, now: number) => r.estado === "En proceso" && Date.parse(r.iniciado ?? r.createdTime) < now - EN_PROCESO_COLGADO_MS;

export function vistaComprobante(r: ComprobanteRow, now = Date.now()): ComprobanteVista {
  return {
    id: r.id,
    label: r.label,
    estado: r.estado,
    ambiente: r.ambiente,
    puntoVenta: r.puntoVenta,
    numero: r.numero,
    cae: r.cae,
    vencimientoCae: r.vencimientoCae,
    total: r.total === null ? null : Math.round(r.total * 100),
    mensaje: r.mensaje,
    pdf: r.estado === "Autorizada" && autorizacionDelSnapshot(r.datos) !== null,
    verificable: r.estado === "Incierta" || colgado(r, now),
    completable: pendienteDeRegistro(r),
    pendienteRegistro: pendienteDeRegistro(r),
    datosIncompletos: datosIncompletos(r),
  };
}

/**
 * Registro pendiente (CC-F5-11), derivado de los datos y nunca del texto de Mensaje: una factura
 * Autorizada en Producción sin el link a la Venta. `registrar` escribe el link a la Venta y a las
 * horas en el mismo update, DESPUÉS de crear la Venta y de marcar las horas como Facturada: si
 * cualquiera de esos pasos falla, el link no existe.
 */
export const pendienteDeRegistro = (r: Pick<ComprobanteRow, "estado" | "ambiente" | "venta" | "datos">) =>
  r.estado === "Autorizada" && r.ambiente === "Producción" && r.venta === null && autorizacionDelSnapshot(r.datos) !== null;

/** Producción + Autorizada con un snapshot sin autorización completa (CC-F5-12): se revisa a mano, sin «Completar registro». */
export const datosIncompletos = (r: Pick<ComprobanteRow, "estado" | "ambiente" | "datos">) => r.estado === "Autorizada" && r.ambiente === "Producción" && autorizacionDelSnapshot(r.datos) === null;

export async function cargarEstadoFactura(clienteId: string, mes: string, now = new Date()): Promise<ServiceResult<FacturaEstado>> {
  const config = configLike();
  const ctx = await cargarContexto(clienteId, mes, config);
  if (!ctx.ok) return ctx;
  const d = ctx.data;
  const arsProforma = d.proformaTotales.find((t) => t.moneda === "ARS");
  return {
    ok: true,
    data: {
      ambiente: config.ambiente,
      configurada: config.error === null,
      elegible: d.motivos.length === 0,
      motivos: d.motivos,
      hoy: todayInBuenosAires(now),
      importes: d.importes,
      proformaTotales: d.proformaTotales,
      difiere: d.proformaTotales.length !== 1 || !arsProforma || arsProforma.subtotal !== d.importes.neto || arsProforma.total !== d.importes.total,
      alicuota: d.alicuota,
      detalleSugerido: detalleSugerido(d.proyectos.map((p) => p.codigo), d.mesLabel),
      comprobantes: d.comprobantes.map((r) => vistaComprobante(r, now.getTime())),
    },
  };
}

// ── Escrituras del registro ──────────────────────────────────────────────────

type CeFields = Record<string, unknown>;

async function updateRow(id: string, fields: CeFields): Promise<void> {
  const bad = invalidFieldIds(CE.id, fields);
  if (bad.length > 0) throw new Error("payload inválido");
  await getAirtableClient().update(CE.id, [{ id, fields }], { returnFields: [] });
}

/** Update que no lanza (se loguea solo el ID). */
async function updateRowQuiet(id: string, fields: CeFields): Promise<boolean> {
  try {
    await updateRow(id, fields);
    return true;
  } catch {
    console.error("[factura] No se pudo actualizar el comprobante", { id });
    return false;
  }
}

const nowIso = (now: Date) => now.toISOString();

/** ¿Gana este registro la clave? Gana el más viejo (createdTime; empate: ID más bajo) entre los activos. */
async function ganaLaClave(own: string, cliente: string, mes: string, ambiente: Ambiente): Promise<boolean> {
  const rows = (await comprobantesDe(cliente, mes)).filter((r) => esActivo(r, ambiente));
  if (!rows.some((r) => r.id === own)) throw new Error("relectura sin el registro propio");
  const winner = rows.reduce((a, b) => {
    const ta = Date.parse(a.createdTime);
    const tb = Date.parse(b.createdTime);
    if (ta !== tb) return tb < ta ? b : a;
    return b.id < a.id ? b : a;
  });
  return winner.id === own;
}

async function descartar(id: string): Promise<void> {
  try {
    await getAirtableClient().delete(CE.id, [id]);
  } catch {
    // Si no se puede borrar, queda Rechazada (no ocupa la clave).
    await updateRowQuiet(id, { [F.estado]: "Rechazada", [F.mensaje]: FACTURA_MESSAGES.enParalelo, [F.finalizado]: nowIso(new Date()) });
  }
}

// ── Emisión ──────────────────────────────────────────────────────────────────

export interface EmisionResultado {
  id: string;
  estado: EstadoComprobante;
  mensaje: string | null;
}

export interface WsfeDeps {
  /** Para tests: el cliente WSFE (con fetch falso). */
  wsfe?: (config: FacturaConfig) => WsfeClient;
}

const wsfeDe = (config: FacturaConfig, deps: WsfeDeps) => deps.wsfe?.(config) ?? new WsfeClient(config);

function cuitEmisor(config: FacturaConfig, params: Map<string, string>): string {
  return config.cuitFija ?? normalizeCuit(params.get(PARAMS.cuit) ?? "");
}

function puntoVentaDe(config: FacturaConfig, params: Map<string, string>): number {
  return config.environment === "dev" ? DEV_PUNTO_VENTA : parsePuntoVenta(params.get(PARAMS.puntoVenta))!;
}

/** Mensaje de un AfipSdkError en una lectura previa a FECAESolicitar (nada se emitió). */
function mensajePrevio(err: unknown): string {
  if (err instanceof AfipSdkError && err.kind === "rejected" && err.detail) return err.detail;
  if (err instanceof AfipSdkError && err.kind === "config") return "La integración con ARCA no está configurada correctamente.";
  return "ARCA no respondió; probá de nuevo en unos minutos.";
}

export async function emitirFactura(user: SessionUser, body: Record<string, unknown>, now = new Date(), deps: WsfeDeps = {}): Promise<ServiceResult<EmisionResultado>> {
  const cfg = getFacturaConfig();
  if (!cfg.ok) return fail(503, cfg.error);
  const config = cfg.config;
  const hoy = todayInBuenosAires(now);
  const v = validarEmitir(body, hoy);
  if (!v.ok) return fail(400, v.error);
  const input = v.data;

  const ctxRes = await cargarContexto(input.cliente, input.mes, { ambiente: config.ambiente, error: null });
  if (!ctxRes.ok) return ctxRes;
  const ctx = ctxRes.data;
  if (ctx.motivos.length > 0) return fail(409, `${FACTURA_MESSAGES.noElegible} ${ctx.motivos.join(" ")}`);

  const ivaId = ivaIdDe(ctx.alicuota)!;
  const periodo = periodoDelMes(input.mes);
  const ptoVta = puntoVentaDe(config, ctx.parametros);
  const cuit = cuitEmisor(config, ctx.parametros);
  const p = (k: string) => (ctx.parametros.get(k) ?? "").trim();
  const datos: FacturaDatos = {
    version: 1,
    ambiente: config.ambiente,
    tipo: TIPO_FACTURA_A,
    cbteTipo: CBTE_TIPO_FACTURA_A,
    emisor: {
      razonSocial: p(PARAMS.empresa),
      cuit,
      domicilioComercial: p(PARAMS.domicilio),
      condicionIva: CONDICION_IVA_EMISOR,
      ingresosBrutos: p(PARAMS.ingresosBrutos),
      inicioActividades: p(PARAMS.inicioActividades),
      leyenda: p(PARAMS.leyenda) || null,
    },
    receptor: {
      clienteId: ctx.cliente.id,
      razonSocial: ctx.cliente.razonSocial,
      cuit: ctx.cliente.cuit,
      condicionIva: ctx.cliente.condicionIva ?? "",
      condicionIvaReceptorId: CONDICION_IVA_RECEPTOR_IDS[ctx.cliente.condicionIva ?? ""],
      domicilioComercial: ctx.cliente.domicilioComercial,
      condicionVenta: CONDICION_VENTA,
    },
    mes: input.mes,
    periodoDesde: periodo.desde,
    periodoHasta: periodo.hasta,
    fechaEmision: hoy,
    vencimientoPago: input.vencimientoPago,
    puntoVenta: ptoVta,
    numero: null,
    detalle: {
      descripcion: input.detalle,
      cantidad: 1,
      unidad: UNIDAD_MEDIDA,
      precioUnitario: ctx.importes.neto,
      bonificacion: 0,
      subtotal: ctx.importes.neto,
      subtotalConIva: ctx.importes.total,
    },
    alicuota: ctx.alicuota,
    ivaId,
    importes: ctx.importes,
    horas: ctx.horas,
    proyectos: ctx.proyectos.map((x) => x.id),
    cae: null,
    vencimientoCae: null,
  };
  const label = (numero: number | null) => comprobanteLabel({ puntoVenta: ptoVta, numero, cliente: ctx.cliente.nombre, mes: input.mes, ambiente: config.ambiente });

  // 1. «En proceso» ANTES de hablar con WSFE.
  const fields: CeFields = {
    [F.comprobante]: label(null),
    [F.tipo]: TIPO_FACTURA_A,
    [F.ambiente]: config.ambiente,
    [F.estado]: "En proceso",
    [F.cliente]: [ctx.cliente.id],
    [F.mes]: `${input.mes}-01`,
    [F.usuario]: [user.id],
    [F.puntoVenta]: ptoVta,
    [F.fechaEmision]: hoy,
    [F.vencimientoPago]: input.vencimientoPago,
    [F.neto]: centsToWsfe(ctx.importes.neto),
    [F.iva]: centsToWsfe(ctx.importes.iva),
    [F.total]: centsToWsfe(ctx.importes.total),
    [F.alicuota]: ctx.alicuota,
    [F.datos]: JSON.stringify(datos),
    [F.iniciado]: nowIso(now),
  };
  if (invalidFieldIds(CE.id, fields).length > 0) {
    console.error("[factura] Payload inválido (bug del servidor)");
    return fail(500, FACTURA_MESSAGES.noElegible);
  }
  const [created] = await getAirtableClient().create(CE.id, [fields], { returnFields: [] });
  const id = created.id;

  // 2. Verificación posterior de la clave: el que pierde se borra y nunca llama a WSFE.
  let gana: boolean;
  try {
    gana = await ganaLaClave(id, ctx.cliente.id, input.mes, config.ambiente);
  } catch {
    console.error("[factura] Verificación posterior fallida", { id });
    await descartar(id);
    return fail(503, "No pudimos verificar los comprobantes de este cliente y mes. Probá de nuevo en unos minutos.");
  }
  if (!gana) {
    await descartar(id);
    return fail(409, FACTURA_MESSAGES.enParalelo);
  }

  // 2b. CC-F5-12/F-12: las horas pueden haber cambiado entre la lectura del contexto y la creación del
  // registro. Desde que el registro existe, la guarda de borrado las protege; se releen ahora, ANTES de
  // hablar con WSFE: si falta alguna, ya no es facturable o ya no está Pendiente → Rechazada, sin WSFE.
  try {
    if (!(await horasSiguenPendientes(datos.horas))) {
      await updateRowQuiet(id, { [F.estado]: "Rechazada", [F.mensaje]: FACTURA_MESSAGES.horasCambiaron, [F.finalizado]: nowIso(new Date()) });
      return { ok: true, data: { id, estado: "Rechazada", mensaje: FACTURA_MESSAGES.horasCambiaron } };
    }
  } catch {
    console.error("[factura] No se pudieron releer las horas antes de emitir", { id });
    await updateRowQuiet(id, { [F.estado]: "Rechazada", [F.mensaje]: FACTURA_MESSAGES.horasNoVerificadas, [F.finalizado]: nowIso(new Date()) });
    return fail(503, FACTURA_MESSAGES.horasNoVerificadas);
  }

  // 3. Número: FECompUltimoAutorizado + 1, guardado ANTES de pedir el CAE.
  const wsfe = wsfeDe(config, deps);
  let auth: WsfeAuth;
  let numero: number;
  try {
    auth = await wsfe.auth(cuit);
    numero = (await wsfe.ultimoAutorizado(auth, cuit, ptoVta, CBTE_TIPO_FACTURA_A)) + 1;
  } catch (err) {
    // Nada se pidió todavía: Rechazada (la clave queda libre).
    console.error("[factura] No se pudo preparar el pedido a ARCA", { id, ...(err instanceof AfipSdkError ? err.toJSON() : {}) });
    const mensaje = mensajePrevio(err);
    await updateRowQuiet(id, { [F.estado]: "Rechazada", [F.mensaje]: mensaje, [F.finalizado]: nowIso(new Date()) });
    return { ok: true, data: { id, estado: "Rechazada", mensaje } };
  }
  datos.numero = numero;
  try {
    await updateRow(id, { [F.numero]: numero, [F.comprobante]: label(numero), [F.datos]: JSON.stringify(datos) });
  } catch {
    console.error("[factura] No se pudo guardar el número antes de pedir el CAE", { id });
    await updateRowQuiet(id, { [F.estado]: "Rechazada", [F.mensaje]: "No pudimos guardar el número antes de pedir el CAE. Probá de nuevo.", [F.finalizado]: nowIso(new Date()) });
    return fail(503, "No pudimos guardar el comprobante. Probá de nuevo en unos minutos.");
  }

  // 4. FECAESolicitar, UNA vez.
  let resultado;
  try {
    resultado = await wsfe.solicitarCae(auth, cuit, {
      ptoVta,
      cbteTipo: CBTE_TIPO_FACTURA_A,
      concepto: CONCEPTO_SERVICIOS,
      docTipo: DOC_TIPO_CUIT,
      docNro: Number(ctx.cliente.cuit),
      cbteNro: numero,
      cbteFch: isoToWsfe(hoy),
      fchServDesde: isoToWsfe(periodo.desde),
      fchServHasta: isoToWsfe(periodo.hasta),
      fchVtoPago: isoToWsfe(input.vencimientoPago),
      impNeto: centsToWsfe(ctx.importes.neto),
      impIva: centsToWsfe(ctx.importes.iva),
      impTotal: centsToWsfe(ctx.importes.total),
      ivaId,
      condicionIvaReceptorId: datos.receptor.condicionIvaReceptorId,
    });
  } catch (err) {
    const definitivo = err instanceof AfipSdkError && (err.kind === "rejected" || err.kind === "config");
    console.error("[factura] FECAESolicitar sin respuesta válida", { id, ...(err instanceof AfipSdkError ? err.toJSON() : {}) });
    if (definitivo) {
      const mensaje = (err as AfipSdkError).detail || ((err as AfipSdkError).kind === "config" ? "La integración con ARCA no está configurada correctamente." : FACTURA_MESSAGES.rechazada);
      await updateRowQuiet(id, { [F.estado]: "Rechazada", [F.mensaje]: mensaje, [F.finalizado]: nowIso(new Date()) });
      return { ok: true, data: { id, estado: "Rechazada", mensaje } };
    }
    await updateRowQuiet(id, { [F.estado]: "Incierta", [F.mensaje]: FACTURA_MESSAGES.incierta, [F.finalizado]: nowIso(new Date()) });
    return { ok: true, data: { id, estado: "Incierta", mensaje: FACTURA_MESSAGES.incierta } };
  }

  if (resultado.resultado === "R") {
    const mensaje = resultado.lineas.length > 0 ? resultado.lineas.join("\n") : FACTURA_MESSAGES.rechazada;
    await updateRowQuiet(id, { [F.estado]: "Rechazada", [F.mensaje]: mensaje, [F.finalizado]: nowIso(new Date()) });
    return { ok: true, data: { id, estado: "Rechazada", mensaje } };
  }
  return autorizar(id, { ...datos, numero }, resultado.cae, resultado.caeFchVto, label(numero), resultado.observaciones);
}

/** Pasa a Autorizada con el CAE y (Producción) registra Ventas y Horas. Nunca deshace la factura. */
/**
 * Pasa a Autorizada. Número, CAE y Vencimiento CAE van al snapshot (Datos) en el MISMO update que
 * los campos de la fila (CC-F5-11): el PDF sale solo de Datos. Las Observaciones de ARCA quedan
 * siempre en Mensaje (los dos ambientes). Nunca deshace la factura.
 */
async function autorizar(id: string, datos: FacturaDatos & { numero: number }, cae: string, vencimientoCae: string, label: string, observaciones: string[] = []): Promise<ServiceResult<EmisionResultado>> {
  const conCae: FacturaDatos = { ...datos, numero: datos.numero, cae, vencimientoCae };
  const mensajeObs = observaciones.length > 0 ? observaciones.join("\n") : null;
  try {
    await updateRow(id, {
      [F.estado]: "Autorizada",
      [F.cae]: cae,
      [F.vencimientoCae]: vencimientoCae,
      [F.numero]: conCae.numero,
      [F.comprobante]: label,
      [F.datos]: JSON.stringify(conCae),
      // CC-F5-12: solo Producción, la misma Clave ARCA que usará la Venta (bloquea borrarla aunque falte el link).
      ...(datos.ambiente === "Producción" ? { [F.claveArca]: claveArca(CBTE_TIPO_FACTURA_A, conCae.puntoVenta, conCae.numero!, conCae.receptor.cuit) } : {}),
      [F.mensaje]: mensajeObs,
      [F.finalizado]: nowIso(new Date()),
    });
  } catch {
    // ARCA la autorizó pero no la pudimos guardar: queda «En proceso» y se resuelve con Verificar.
    console.error("[factura] Autorizada en ARCA pero no se pudo guardar el CAE", { id });
    return fail(500, "ARCA autorizó la factura pero no pudimos guardarla. En unos minutos usá «Verificar en ARCA».");
  }
  if (datos.ambiente !== "Producción") return { ok: true, data: { id, estado: "Autorizada", mensaje: mensajeObs } };
  const reg = await registrar(id, conCae, mensajeObs);
  return { ok: true, data: { id, estado: "Autorizada", mensaje: reg ? mensajeObs : [FACTURA_MESSAGES.faltaRegistro, mensajeObs].filter(Boolean).join("\n") } };
}

// ── Registro en Ventas y Horas (solo Producción, idempotente) ────────────────

/** Campos de Ventas por alícuota: neto e IVA (0 % no tiene campo de IVA). */
const VENTAS_POR_ALICUOTA: Readonly<Record<number, { neto: string; iva: string | null }>> = {
  0: { neto: V.netoGravIva0, iva: null },
  25: { neto: V.netoGravIva25, iva: V.iva25 },
  50: { neto: V.netoGravIva5, iva: V.iva5 },
  105: { neto: V.netoGravIva105, iva: V.iva105 },
  210: { neto: V.netoGravIva21, iva: V.iva21 },
  270: { neto: V.netoGravIva27, iva: V.iva27 },
};

/** Campos de la Venta, en el mismo formato que una fila sincronizada de ARCA (CC-F5-10, verificado con Ventas reales). */
export function camposVenta(d: FacturaDatos, tipoComprobanteId: string): Record<string, unknown> {
  const rate = VENTAS_POR_ALICUOTA[Math.round(d.alicuota * 1000)];
  const out: Record<string, unknown> = {
    [V.claveArca]: claveArca(CBTE_TIPO_FACTURA_A, d.puntoVenta, d.numero!, d.receptor.cuit),
    [V.fecha]: d.fechaEmision,
    [V.tipo]: "1 - Factura A",
    [V.tipoComprobante]: [tipoComprobanteId],
    [V.puntoVenta]: d.puntoVenta,
    [V.numeroDesde]: d.numero,
    [V.numeroHasta]: d.numero,
    [V.codAutorizacion]: d.cae,
    [V.tipoDocReceptor]: "CUIT",
    [V.nroDocReceptor]: d.receptor.cuit,
    [V.denominacionReceptor]: d.receptor.razonSocial,
    [V.tipoCambio]: 1,
    [V.moneda]: "$",
    [rate.neto]: centsToWsfe(d.importes.neto),
    [V.netoGravadoTotal]: centsToWsfe(d.importes.neto),
    [V.netoNoGravado]: 0,
    [V.opExentas]: 0,
    [V.otrosTributos]: 0,
    [V.totalIva]: centsToWsfe(d.importes.iva),
    [V.impTotal]: centsToWsfe(d.importes.total),
    [V.mesDevengado]: `${d.mes}-01`,
    [V.cliente]: [d.receptor.clienteId],
  };
  if (rate.iva) out[rate.iva] = centsToWsfe(d.importes.iva);
  if (d.proyectos.length === 1) out[V.proyecto] = [d.proyectos[0]];
  return out;
}

/**
 * Crea lo que falte: la Venta (unicidad por Clave ARCA después de escribir), las horas en
 * Facturada (Compensation; si falla, se restauran) y los links del comprobante. true si quedó todo.
 */
/** Relee las horas del snapshot: true si todas existen, son facturables y siguen en Pendiente. Lanza si no se puede leer. */
async function horasSiguenPendientes(ids: readonly string[]): Promise<boolean> {
  const leidas = await leerHoras(ids, [H.facturable, H.estadoFacturacion]);
  return ids.every((h) => {
    const r = leidas.get(h);
    return r !== undefined && r.fields[H.facturable] === true && estadoEfectivo(r.fields[H.estadoFacturacion]) === "Pendiente";
  });
}

/** Horas por ID, en lotes de 100 (se filtra en código también). */
async function leerHoras(ids: readonly string[], fields: string[]): Promise<Map<string, { id: string; fields: Record<string, unknown> }>> {
  const out = new Map<string, { id: string; fields: Record<string, unknown> }>();
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    const rows = await getAirtableClient().list(TABLES.horas.id, { fields, filterByFormula: or(...lote.map(recordIdIs)) });
    for (const r of rows) if (lote.includes(r.id)) out.set(r.id, r);
  }
  return out;
}

/**
 * `mensaje`: el Mensaje actual del comprobante (Observaciones). Si alguna hora del snapshot ya no
 * existe (CC-F5-13), el registro sigue (la factura es válida: el snapshot tiene IDs e importes), se
 * marcan Facturada solo las que existen y los IDs faltantes se agregan a Mensaje.
 */
async function registrar(id: string, d: FacturaDatos, mensaje: string | null = null): Promise<boolean> {
  const client = getAirtableClient();
  const clave = claveArca(CBTE_TIPO_FACTURA_A, d.puntoVenta, d.numero!, d.receptor.cuit);
  try {
    // Venta: la existente con la misma Clave ARCA (p. ej. una sincronización), o una nueva.
    const porClave = () => client.list(TABLES.ventas.id, { fields: [V.claveArca], filterByFormula: formula`${field(V.claveArca)} = ${clave}` });
    const ventas = await porClave();
    let ventaId = ventas.find((r) => text(r.fields[V.claveArca]) === clave)?.id ?? null;
    if (!ventaId) {
      const tipos = await client.list(TABLES.tiposComprobante.id, { fields: [TABLES.tiposComprobante.fields.codigo] });
      const tipo = tipos.find((r) => r.fields[TABLES.tiposComprobante.fields.codigo] === CBTE_TIPO_FACTURA_A);
      if (!tipo) throw new Error("falta el tipo de comprobante 1");
      const tx = new Compensation();
      injectFault("factura:ventas:0");
      const nuevo = await tx.create(TABLES.ventas.id, camposVenta(d, tipo.id));
      if (await losesUniqueRace(TABLES.ventas.id, V.claveArca, clave, nuevo, "create")) {
        await tx.discardCreated(TABLES.ventas.id, [nuevo]);
        const otra = (await porClave()).find((r) => text(r.fields[V.claveArca]) === clave);
        if (!otra) throw new Error("venta ganadora no encontrada");
        ventaId = otra.id;
      } else ventaId = nuevo;
    }

    // Horas: Facturada (las Pagada/Facturada quedan como están).
    const horas = [...(await leerHoras(d.horas, [H.estadoFacturacion])).values()];
    const pendientes = horas.filter((r) => estadoEfectivo(r.fields[H.estadoFacturacion]) === "Pendiente");
    if (pendientes.length > 0) {
      const tx = new Compensation();
      try {
        await tx.update(
          TABLES.horas.id,
          pendientes.map((r) => ({ id: r.id, fields: { [H.estadoFacturacion]: "Facturada" }, previous: { [H.estadoFacturacion]: (r.fields[H.estadoFacturacion] as string | undefined) ?? null } })),
          (i) => injectFault(`factura:horas:${i}`),
        );
      } catch (err) {
        const ok = await tx.rollback();
        console.error("[factura] No se pudieron marcar las horas como facturadas", { id, rollback: ok ? "ok" : "fallido" });
        throw err;
      }
    }

    // Links del comprobante.
    const existentes = new Set(horas.map((r) => r.id));
    const faltantes = d.horas.filter((h) => !existentes.has(h));
    // Venta y horas en el mismo update: es la marca de «registro completo» (ver pendienteDeRegistro).
    // Mensaje solo cambia para anotar horas que ya no existen (se conservan las Observaciones).
    const nota = faltantes.length > 0 ? FACTURA_MESSAGES.horasFaltantes(faltantes) : null;
    const nuevoMensaje = nota && !(mensaje ?? "").includes(nota) ? [mensaje, nota].filter(Boolean).join("\n") : undefined;
    injectFault("factura:links");
    await updateRow(id, { [F.venta]: [ventaId], [F.horas]: d.horas.filter((h) => existentes.has(h)), ...(nuevoMensaje !== undefined ? { [F.mensaje]: nuevoMensaje } : {}) });
    if (faltantes.length > 0) console.error("[factura] Horas del snapshot que ya no existen", { id, horas: faltantes });
    return true;
  } catch {
    console.error("[factura] Falta registrar en Ventas/Horas", { id });
    return false;
  }
}

/** «Completar registro»: idempotente, solo Producción + Autorizada. */
export async function completarRegistro(id: string): Promise<ServiceResult<EmisionResultado>> {
  const row = await leerComprobante(id);
  if (!row) return fail(404, FACTURA_MESSAGES.noEncontrado);
  const snap = autorizacionDelSnapshot(row.datos);
  if (!pendienteDeRegistro(row) || !snap) return fail(409, FACTURA_MESSAGES.noPendiente);
  const ok = await registrar(id, snap, row.mensaje);
  if (!ok) return fail(503, FACTURA_MESSAGES.faltaRegistro);
  return { ok: true, data: { id, estado: "Autorizada", mensaje: (await leerComprobante(id))?.mensaje ?? row.mensaje } };
}

// ── Verificar en ARCA (Incierta) ─────────────────────────────────────────────

export async function verificarComprobante(id: string, now = new Date(), deps: WsfeDeps = {}): Promise<ServiceResult<EmisionResultado>> {
  const cfg = getFacturaConfig();
  if (!cfg.ok) return fail(503, cfg.error);
  const row = await leerComprobante(id);
  if (!row) return fail(404, FACTURA_MESSAGES.noEncontrado);
  if (!(row.estado === "Incierta" || colgado(row, now.getTime())) || !row.datos) return fail(409, FACTURA_MESSAGES.noIncierta);
  if (row.ambiente !== cfg.config.ambiente) return fail(409, `Esta factura es de ${row.ambiente}; la app está en ${cfg.config.ambiente}.`);
  const datos = row.datos;
  // Sin número guardado: FECAESolicitar nunca se mandó.
  if (row.numero === null) {
    await updateRowQuiet(id, { [F.estado]: "Rechazada", [F.mensaje]: FACTURA_MESSAGES.noEmitida, [F.finalizado]: nowIso(now) });
    return { ok: true, data: { id, estado: "Rechazada", mensaje: FACTURA_MESSAGES.noEmitida } };
  }
  const wsfe = wsfeDe(cfg.config, deps);
  const cuit = datos.emisor.cuit;
  let ultimo: number;
  let consulta;
  try {
    const auth = await wsfe.auth(cuit);
    ultimo = await wsfe.ultimoAutorizado(auth, cuit, datos.puntoVenta, CBTE_TIPO_FACTURA_A);
    consulta = ultimo >= row.numero ? await wsfe.consultar(auth, cuit, datos.puntoVenta, CBTE_TIPO_FACTURA_A, row.numero) : null;
  } catch (err) {
    console.error("[factura] Verificación sin respuesta", { id, ...(err instanceof AfipSdkError ? err.toJSON() : {}) });
    return fail(503, "ARCA no respondió; probá de nuevo en unos minutos.");
  }
  if (ultimo < row.numero) {
    await updateRowQuiet(id, { [F.estado]: "Rechazada", [F.mensaje]: FACTURA_MESSAGES.noEmitida, [F.finalizado]: nowIso(now) });
    return { ok: true, data: { id, estado: "Rechazada", mensaje: FACTURA_MESSAGES.noEmitida } };
  }
  // CC-F5-11: además de coincidir, ARCA tiene que informarla autorizada (Resultado "A", CAE de 14
  // dígitos, FchVto válida), como en la forma real de FECompConsultar (ResultGet.Resultado/CodAutorizacion/FchVto).
  const vencimiento = consulta ? wsfeToIso(consulta.caeFchVto) : null;
  const coincide =
    consulta !== null &&
    consulta.resultado === "A" &&
    consulta.cae !== null &&
    /^\d{14}$/.test(consulta.cae) &&
    vencimiento !== null &&
    consulta.docNro.replace(/\D/g, "") === datos.receptor.cuit &&
    consulta.impTotal !== null &&
    Math.round(consulta.impTotal * 100) === datos.importes.total &&
    wsfeToIso(consulta.cbteFch) === datos.fechaEmision;
  if (!coincide) {
    await updateRowQuiet(id, { [F.estado]: "Incierta", [F.mensaje]: FACTURA_MESSAGES.revisarManual });
    return { ok: true, data: { id, estado: "Incierta", mensaje: FACTURA_MESSAGES.revisarManual } };
  }
  return autorizar(id, { ...datos, numero: row.numero }, consulta!.cae!, vencimiento!, row.label);
}

// ── PDF ──────────────────────────────────────────────────────────────────────

/**
 * Datos del PDF (CC-F5-11): EXCLUSIVAMENTE del snapshot. Número, CAE y Vencimiento CAE de la fila son
 * solo para listar y filtrar; si el snapshot no tiene una autorización completa → 409 (sin PDF).
 */
export async function datosParaPdf(id: string): Promise<ServiceResult<FacturaDatos & { numero: number; cae: string }>> {
  const row = await leerComprobante(id);
  if (!row) return fail(404, FACTURA_MESSAGES.noEncontrado);
  const snap = row.estado === "Autorizada" ? autorizacionDelSnapshot(row.datos) : null;
  if (!snap) return fail(409, FACTURA_MESSAGES.sinPdf);
  return { ok: true, data: snap };
}
