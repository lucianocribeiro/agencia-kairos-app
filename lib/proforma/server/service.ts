import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { and, field, formula, or, type Formula } from "@/lib/airtable/formula";
import { TABLES } from "@/lib/airtable/schema";
import type { ServiceResult } from "@/lib/abm/types";
import { isClienteActivo } from "@/lib/abm/cliente-estado";
import { addDays, todayInBuenosAires } from "@/lib/horas/dates";
import { aplicarTipoCambio, leerTipoCambio } from "../tipo-cambio";
import { calcularProforma, isMesProforma, PARAM_ALICUOTA, parseAlicuota, PROFORMA_MESSAGES, type HoraP, type Moneda, type ProformaData, type ProyectoP } from "../proforma";

/**
 * Proforma de horas (Admin). Solo lee: clientes, el Parámetro de la alícuota, los
 * proyectos, los usuarios (nombre) y las Horas candidatas del mes. No escribe nada.
 */

const H = TABLES.horas.fields;
const P = TABLES.proyectos.fields;
const C = TABLES.clientes.fields;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const first = (v: unknown): string | null => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);
const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

export const HORA_FIELDS = [H.fecha, H.colaborador, H.proyecto, H.tarea, H.horaDesde, H.horaHasta, H.facturable, H.mesAFacturar];
export const PROYECTO_FIELDS = [P.codigo, P.cliente, P.valorHora, P.monedaValorHora];
export const CLIENTE_FIELDS = [C.nombre, C.sigla, C.estado, C.cuit, C.condicionIva];

export interface ClienteOpcion {
  id: string;
  nombre: string;
}

/** Último día del mes "AAAA-MM" ("AAAA-MM-DD"). */
const ultimoDia = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** Campo date dentro de [desde, hasta] (bordes exclusivos sobre el día anterior y el posterior, como fechaRangeFormula). */
function enRango(fieldId: string, desde: string, hasta: string): Formula {
  const f = field(fieldId);
  return and(f, formula`IS_AFTER(${f}, ${addDays(desde, -1)})`, formula`IS_BEFORE(${f}, ${addDays(hasta, 1)})`);
}

/**
 * Candidatas en Airtable: Mes a facturar en el mes, O Mes a facturar vacío y Fecha en el
 * mes. Cliente y Facturable se filtran en código (y el mes otra vez, por el string).
 */
export function horasDelMesFormula(mes: string): Formula {
  const desde = `${mes}-01`;
  const hasta = ultimoDia(mes);
  return or(enRango(H.mesAFacturar, desde, hasta), and(formula`NOT(${field(H.mesAFacturar)})`, enRango(H.fecha, desde, hasta)));
}

/** Clientes Activos para el selector, por nombre. */
export async function clientesActivos(): Promise<ClienteOpcion[]> {
  const rows = await getAirtableClient().list(TABLES.clientes.id, { fields: [C.nombre, C.estado] });
  return rows
    .filter((r) => isClienteActivo(r.fields[C.estado]))
    .map((r) => ({ id: r.id, nombre: text(r.fields[C.nombre]) || "(sin nombre)" }))
    .sort((a, b) => collator.compare(a.nombre, b.nombre));
}

export interface ProformaQuery {
  cliente?: string | null;
  mes?: string | null;
  /** Tipo de cambio es-AR (CC-F5-21), opcional; inválido → 400. Solo convierte si hay USD. */
  tc?: string | null;
}

/** Valida los parámetros sin leer la base: { cliente, mes } o un error 400. */
export function validarQuery(q: ProformaQuery, now = new Date()): { cliente: string | null; mes: string } | { error: string } {
  const mes = q.mes || todayInBuenosAires(now).slice(0, 7);
  if (!isMesProforma(mes)) return { error: PROFORMA_MESSAGES.mes };
  if (q.cliente && !RECORD_ID_RE.test(q.cliente)) return { error: PROFORMA_MESSAGES.clienteInexistente };
  return { cliente: q.cliente || null, mes };
}

export async function cargarProforma(q: ProformaQuery, now = new Date()): Promise<ServiceResult<ProformaData>> {
  const v = validarQuery(q, now);
  if ("error" in v) return { ok: false, status: 400, error: v.error };
  if (!v.cliente) return { ok: false, status: 400, error: PROFORMA_MESSAGES.cliente };
  const tc = leerTipoCambio(q.tc);
  if ("error" in tc) return { ok: false, status: 400, error: tc.error };
  const client = getAirtableClient();
  const PA = TABLES.parametros.fields;
  const [cliente, parametros] = await Promise.all([
    client.get(TABLES.clientes.id, v.cliente, { fields: CLIENTE_FIELDS }),
    client.list(TABLES.parametros.id, { fields: [PA.concepto, PA.valor] }),
  ]);
  if (!cliente) return { ok: false, status: 404, error: PROFORMA_MESSAGES.clienteInexistente };
  if (!isClienteActivo(cliente.fields[C.estado])) return { ok: false, status: 400, error: PROFORMA_MESSAGES.clienteInactivo };
  const param = parametros.find((r) => text(r.fields[PA.concepto]) === PARAM_ALICUOTA);
  const alicuota = parseAlicuota(param?.fields[PA.valor]);
  if (alicuota === null) return { ok: false, status: 409, error: PROFORMA_MESSAGES.alicuota };

  const [proyectos, horas, usuarios] = await Promise.all([
    client.list(TABLES.proyectos.id, { fields: PROYECTO_FIELDS }),
    client.list(TABLES.horas.id, { fields: HORA_FIELDS, filterByFormula: horasDelMesFormula(v.mes) }),
    client.list(TABLES.usuarios.id, { fields: [TABLES.usuarios.fields.nombre] }),
  ]);
  const moneda = (x: unknown): Moneda | null => (x === "ARS" || x === "USD" ? x : null);
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const proyectosP: ProyectoP[] = proyectos.map((r) => ({
    id: r.id,
    codigo: text(r.fields[P.codigo]) || "(sin código)",
    cliente: first(r.fields[P.cliente]),
    valorHora: num(r.fields[P.valorHora]),
    moneda: moneda(r.fields[P.monedaValorHora]),
  }));
  const horasP: HoraP[] = horas.map((r) => ({
    id: r.id,
    fecha: typeof r.fields[H.fecha] === "string" ? (r.fields[H.fecha] as string) : null,
    colaborador: first(r.fields[H.colaborador]),
    proyecto: first(r.fields[H.proyecto]),
    tarea: text(r.fields[H.tarea]),
    desde: num(r.fields[H.horaDesde]),
    hasta: num(r.fields[H.horaHasta]),
    facturable: r.fields[H.facturable] === true,
    mesAFacturar: typeof r.fields[H.mesAFacturar] === "string" ? (r.fields[H.mesAFacturar] as string) : null,
  }));
  const colaboradores = new Map(usuarios.map((r) => [r.id, text(r.fields[TABLES.usuarios.fields.nombre])]));
  const data = calcularProforma({
    cliente: {
      id: cliente.id,
      nombre: text(cliente.fields[C.nombre]) || "(sin nombre)",
      sigla: text(cliente.fields[C.sigla]),
      cuit: text(cliente.fields[C.cuit]) || null,
      condicionIva: text(cliente.fields[C.condicionIva]) || null,
    },
    mes: v.mes,
    alicuota,
    proyectos: proyectosP,
    horas: horasP,
    colaboradores,
  });
  // CC-F5-21: con USD y un TC válido, el equivalente en pesos (si no, la proforma de siempre).
  return { ok: true, data: aplicarTipoCambio(data, tc.tc) };
}

/** «Proforma_<Sigla>_<AAAAMM>.pdf»; la sigla solo con letras y dígitos (si queda vacía, el ID). */
export function nombreArchivoPdf(d: ProformaData): string {
  const sigla = d.cliente.sigla.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toUpperCase() || d.cliente.id;
  return `Proforma_${sigla}_${d.mes.replace("-", "")}.pdf`;
}
