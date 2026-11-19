import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { TABLES } from "@/lib/airtable/schema";
import type { ServiceResult } from "@/lib/abm/types";
import { calcularImportesCliente } from "@/lib/cliente/importes";
import { alicuotaActual, nombresDeUsuarios } from "@/lib/cliente/server/service";
import type { ClienteImportes } from "@/lib/cliente/types";
import type { Moneda, ProyectoP } from "@/lib/proforma/proforma";
import { vistaToSheet } from "@/lib/reportes/excel";
import { writeXlsx } from "@/lib/xlsx/write";
import { agregarDashboard } from "../dashboard";
import { DASHBOARD_ADMIN_MESSAGES, nombreArchivoDashboard, vistaDashboardAdmin, type DashboardAdminData, type DashboardCliente } from "../dashboard-admin";
import { estadoEfectivo, filtroEstado } from "../estado";
import type { DashboardProject } from "../types";
import { DASHBOARD_MESSAGES, validarDashboardQuery, type DashboardQuery } from "./dashboard-service";
import { HORAS_ADMIN_READ_FIELDS, listHorasInRange } from "./repo";
import { fail } from "./write";

/**
 * Dashboard del Admin con importes (CC-F4-11). Horas: todas (facturables o no), como el
 * dashboard de siempre (`agregarDashboard`). Importes: solo Facturables, con el MISMO cálculo
 * que la vista Cliente (`calcularImportesCliente`, reglas de la Proforma). Filtros nuevos:
 * Cliente (limita proyectos y datos) y Estado de facturación (vacío = Pendiente); valen para
 * toda la pantalla y el Excel.
 */

const P = TABLES.proyectos.fields;
const C = TABLES.clientes.fields;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const first = (v: unknown): string | null => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);
const moneda = (x: unknown): Moneda | null => (x === "ARS" || x === "USD" ? x : null);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

export interface DashboardAdminQuery extends DashboardQuery {
  cliente?: string | null;
  estado?: string | null;
}

type ProyectoAdmin = ProyectoP & { estado: string | null };

export async function cargarDashboardAdmin(query: DashboardAdminQuery, now = new Date()): Promise<ServiceResult<DashboardAdminData>> {
  const q = validarDashboardQuery(query, now);
  if (!q.ok) return q;
  const filtro = filtroEstado(query.estado);
  if ("error" in filtro) return fail(400, filtro.error);
  const clienteId = query.cliente || null;
  if (clienteId && !RECORD_ID_RE.test(clienteId)) return fail(400, DASHBOARD_ADMIN_MESSAGES.cliente);
  const { range, grouping, buckets, selected } = q.data;

  const client = getAirtableClient();
  const [proyRows, cliRows, horas, alicuota, nombres] = await Promise.all([
    client.list(TABLES.proyectos.id, { fields: [P.codigo, P.estado, P.cliente, P.valorHora, P.monedaValorHora] }),
    client.list(TABLES.clientes.id, { fields: [C.nombre, C.sigla] }),
    listHorasInRange(range, HORAS_ADMIN_READ_FIELDS),
    alicuotaActual(),
    nombresDeUsuarios(),
  ]);

  const todos: ProyectoAdmin[] = proyRows
    .map((r) => ({
      id: r.id,
      codigo: text(r.fields[P.codigo]) || "(sin código)",
      estado: (r.fields[P.estado] as string | undefined) ?? null,
      cliente: first(r.fields[P.cliente]),
      valorHora: num(r.fields[P.valorHora]),
      moneda: moneda(r.fields[P.monedaValorHora]),
    }))
    .sort((a, b) => collator.compare(a.codigo, b.codigo));
  const conProyectos = new Set(todos.map((p) => p.cliente).filter((c): c is string => c !== null));
  const clientes: DashboardCliente[] = cliRows
    .filter((r) => conProyectos.has(r.id))
    .map((r) => ({ id: r.id, nombre: text(r.fields[C.nombre]) || "(sin nombre)", sigla: text(r.fields[C.sigla]) }))
    .sort((a, b) => collator.compare(a.nombre, b.nombre));
  if (clienteId && !clientes.some((c) => c.id === clienteId)) return fail(400, DASHBOARD_ADMIN_MESSAGES.cliente);

  // El filtro de proyectos ofrece solo los del cliente elegido (o todos).
  const enFiltro = clienteId ? todos.filter((p) => p.cliente === clienteId) : todos;
  const byId = new Map(enFiltro.map((p) => [p.id, p]));
  if (selected.some((id) => !byId.has(id))) return fail(400, DASHBOARD_MESSAGES.proyectos);

  // Alcance: proyectos elegidos; si no, los del cliente; si no, todos (también sin proyecto).
  const alcance: Set<string> | null = selected.length > 0 ? new Set(selected) : clienteId ? new Set(enFiltro.map((p) => p.id)) : null;
  const filtradas = horas.filter(
    (h) => (alcance === null || (h.proyecto !== null && alcance.has(h.proyecto))) && (!filtro.estado || estadoEfectivo(h.estadoFacturacion) === filtro.estado),
  );

  const todosById = new Map(todos.map((p) => [p.id, p]));
  const ref = (id: string): DashboardProject => {
    const p = todosById.get(id);
    return p ? { id: p.id, codigo: p.codigo, estado: p.estado } : { id, codigo: "(proyecto borrado)", estado: null };
  };
  // Horas: igual que el dashboard de siempre (todas, facturables o no).
  const agregado = agregarDashboard({
    buckets,
    grouping,
    horas: filtradas.map((h) => ({ fecha: h.fecha!, proyecto: h.proyecto, horas: h.horas })),
    seleccion: selected.length > 0 ? selected : null,
    proyecto: ref,
  });

  // Importes: solo Facturables, con el cálculo de la vista Cliente.
  const facturables = filtradas.filter((h) => h.facturable && h.proyecto !== null && todosById.has(h.proyecto));
  const conHoras = new Set(facturables.map((h) => h.proyecto!));
  const enVista: ProyectoP[] = (selected.length > 0 ? enFiltro.filter((p) => selected.includes(p.id)) : clienteId ? enFiltro : todos.filter((p) => conHoras.has(p.id))).map(
    ({ id, codigo, cliente, valorHora, moneda: m }) => ({ id, codigo, cliente, valorHora, moneda: m }),
  );
  const importes: ClienteImportes | null =
    alicuota === null && enVista.length > 0
      ? null
      : calcularImportesCliente({
          proyectos: enVista,
          horas: facturables.map((h) => ({ proyecto: h.proyecto!, colaborador: h.colaborador, horas: h.horas, estado: estadoEfectivo(h.estadoFacturacion) })),
          colaboradores: nombres,
          alicuota: alicuota ?? 0,
        });

  return {
    ok: true,
    data: {
      range,
      grouping,
      buckets,
      rows: agregado.rows,
      columnTotals: agregado.columnTotals,
      total: agregado.total,
      proyectos: enFiltro.map((p) => ({ id: p.id, codigo: p.codigo, estado: p.estado })),
      selected,
      clientes,
      cliente: clienteId,
      estado: filtro.estado,
      importes,
    },
  };
}

/** La misma vista como .xlsx (una hoja): horas con totales + el bloque de importes. */
export function dashboardAdminXlsx(d: DashboardAdminData): { bytes: Buffer; filename: string } {
  return { bytes: writeXlsx(vistaToSheet(vistaDashboardAdmin(d), "Dashboard")), filename: nombreArchivoDashboard(d) };
}

/** Query string → filtros (los del dashboard de siempre + cliente y estado). */
export function queryDashboardAdmin(get: (key: string) => string | null): DashboardAdminQuery {
  return {
    desde: get("desde") || null,
    hasta: get("hasta") || null,
    agrupacion: get("agrupacion") || null,
    proyectos: (get("proyectos") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    cliente: get("cliente") || null,
    estado: get("estado") || null,
  };
}
