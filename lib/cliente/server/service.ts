import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { TABLES } from "@/lib/airtable/schema";
import type { ServiceResult } from "@/lib/abm/types";
import { agregarDashboard } from "@/lib/horas/dashboard";
import { validarDashboardQuery, type DashboardQuery } from "@/lib/horas/server/dashboard-service";
import { estadoEfectivo, filtroEstado } from "@/lib/horas/estado";
import { HORAS_ADMIN_READ_FIELDS, listHorasInRange } from "@/lib/horas/server/repo";
import { ROL_CLIENTE } from "@/lib/roles";
import { PARAM_ALICUOTA, parseAlicuota, type Moneda, type ProyectoP } from "@/lib/proforma/proforma";
import { vistaToSheet } from "@/lib/reportes/excel";
import { writeXlsx } from "@/lib/xlsx/write";
import { calcularImportesCliente } from "../importes";
import { CLIENTE_MESSAGES, type ClienteHorasData, type ClienteImportes, type ClienteProyecto } from "../types";
import { nombreArchivoCliente, vistaCliente } from "../vista";

/**
 * Vista Cliente (solo lectura). Alcance: los Proyectos asignados del usuario, leídos de
 * Airtable en cada request (no de la sesión): un cambio del Admin vale sin re-login.
 * Solo horas Facturables. Dashboard con la agregación del Admin (lib/horas/dashboard.ts);
 * importes con las reglas de la Proforma (lib/cliente/importes.ts). La respuesta se arma
 * campo por campo (lista de campos permitidos, lib/cliente/types.ts).
 */

const U = TABLES.usuarios.fields;
const P = TABLES.proyectos.fields;
const PA = TABLES.parametros.fields;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const first = (v: unknown): string | null => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);
const moneda = (x: unknown): Moneda | null => (x === "ARS" || x === "USD" ? x : null);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Proyectos asignados que existen, con valor hora y moneda actuales, ordenados por Código. */
async function proyectosAsignados(userId: string): Promise<ProyectoP[]> {
  const client = getAirtableClient();
  const user = await client.get(TABLES.usuarios.id, userId, { fields: [U.rol, U.estado, U.proyectosAsignados] });
  if (!user || user.fields[U.rol] !== ROL_CLIENTE || user.fields[U.estado] !== "Activo") return [];
  const ids = new Set(((user.fields[U.proyectosAsignados] as string[] | undefined) ?? []).filter((id) => typeof id === "string"));
  if (ids.size === 0) return [];
  const rows = await client.list(TABLES.proyectos.id, { fields: [P.codigo, P.cliente, P.valorHora, P.monedaValorHora] });
  return rows
    .filter((r) => ids.has(r.id))
    .map((r) => ({
      id: r.id,
      codigo: text(r.fields[P.codigo]) || "(sin código)",
      cliente: first(r.fields[P.cliente]),
      valorHora: num(r.fields[P.valorHora]),
      moneda: moneda(r.fields[P.monedaValorHora]),
    }))
    .sort((a, b) => collator.compare(a.codigo, b.codigo));
}

async function alicuotaActual(): Promise<number | null> {
  const rows = await getAirtableClient().list(TABLES.parametros.id, { fields: [PA.concepto, PA.valor] });
  return parseAlicuota(rows.find((r) => text(r.fields[PA.concepto]) === PARAM_ALICUOTA)?.fields[PA.valor]);
}

async function nombresDeUsuarios(): Promise<Map<string, string>> {
  const rows = await getAirtableClient().list(TABLES.usuarios.id, { fields: [U.nombre] });
  return new Map(rows.map((r) => [r.id, text(r.fields[U.nombre])]));
}

/**
 * Datos de la vista para los filtros del pedido. 400 = filtro inválido; 403 = algún
 * proyecto pedido no está asignado al usuario (URL editada, link viejo).
 */
export interface ClienteQuery extends DashboardQuery {
  /** CC-F4-08: Pendiente / Facturada / Pagada; null = todos. */
  estado?: string | null;
}

export async function cargarVistaCliente(userId: string, query: ClienteQuery, now = new Date()): Promise<ServiceResult<ClienteHorasData>> {
  const q = validarDashboardQuery(query, now);
  if (!q.ok) return q;
  const filtro = filtroEstado(query.estado);
  if ("error" in filtro) return { ok: false, status: 400, error: filtro.error };
  const { range, grouping, buckets, selected } = q.data;

  const asignados = await proyectosAsignados(userId);
  const byId = new Map(asignados.map((p) => [p.id, p]));
  if (selected.some((id) => !byId.has(id))) return { ok: false, status: 403, error: CLIENTE_MESSAGES.noAsignado };
  const enVista = selected.length > 0 ? asignados.filter((p) => selected.includes(p.id)) : asignados;
  const ids = new Set(enVista.map((p) => p.id));

  const [horas, alicuota, nombres] =
    enVista.length > 0
      ? await Promise.all([listHorasInRange(range, HORAS_ADMIN_READ_FIELDS), alicuotaActual(), nombresDeUsuarios()])
      : [[], null, new Map<string, string>()];
  // Solo Facturables de los proyectos de la vista (y del estado elegido): todo lo demás no existe para el Cliente.
  const propias = horas.filter(
    (h) => h.facturable && h.proyecto !== null && ids.has(h.proyecto) && (!filtro.estado || estadoEfectivo(h.estadoFacturacion) === filtro.estado),
  );

  const ref = (p: ProyectoP): ClienteProyecto => ({ id: p.id, codigo: p.codigo });
  const agregado = agregarDashboard({
    buckets,
    grouping,
    horas: propias.map((h) => ({ fecha: h.fecha!, proyecto: h.proyecto, horas: h.horas })),
    seleccion: enVista.map((p) => p.id),
    proyecto: (id) => ref(byId.get(id)!),
  });
  const importes: ClienteImportes | null =
    alicuota === null && enVista.length > 0
      ? null
      : calcularImportesCliente({
          proyectos: enVista,
          horas: propias.map((h) => ({ proyecto: h.proyecto!, colaborador: h.colaborador, horas: h.horas, estado: estadoEfectivo(h.estadoFacturacion) })),
          colaboradores: nombres,
          alicuota: alicuota ?? 0,
        });

  // Lista de campos permitidos: cada objeto se arma acá, campo por campo.
  return {
    ok: true,
    data: {
      range: { desde: range.desde, hasta: range.hasta },
      grouping,
      buckets: buckets.map((b) => ({ key: b.key, label: b.label })),
      proyectos: asignados.map(ref),
      selected,
      estado: filtro.estado,
      rows: agregado.rows.map((r) => ({ proyecto: { id: r.proyecto!.id, codigo: r.proyecto!.codigo }, values: [...r.values], total: r.total })),
      columnTotals: [...agregado.columnTotals],
      total: agregado.total,
      importes: importes && {
        proyectos: importes.proyectos.map((p) => ({
          id: p.id,
          codigo: p.codigo,
          valorHora: p.valorHora,
          moneda: p.moneda,
          horas: p.horas,
          neto: p.neto,
          iva: p.iva,
          total: p.total,
          colaboradores: p.colaboradores.map((c) => ({ nombre: c.nombre, horas: c.horas, neto: c.neto })),
          estados: p.estados.map((e) => ({ estado: e.estado, horas: e.horas, neto: e.neto, iva: e.iva, total: e.total })),
        })),
        totales: importes.totales.map((t) => ({ moneda: t.moneda, neto: t.neto, iva: t.iva, total: t.total })),
      },
    },
  };
}

/** La misma vista como .xlsx (una hoja): horas con totales + importes con el detalle por colaborador. */
export function clienteXlsx(d: ClienteHorasData): { bytes: Buffer; filename: string } {
  return { bytes: writeXlsx(vistaToSheet(vistaCliente(d), "Horas")), filename: nombreArchivoCliente(d) };
}

/** Query string → filtros (los mismos parámetros que el dashboard de Admin). */
export function queryCliente(get: (key: string) => string | null): ClienteQuery {
  return {
    desde: get("desde") || null,
    hasta: get("hasta") || null,
    agrupacion: get("agrupacion") || null,
    proyectos: (get("proyectos") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    estado: get("estado") || null,
  };
}
