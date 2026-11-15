import "server-only";

import { getAirtableClient } from "@/lib/airtable/client";
import { TABLES } from "@/lib/airtable/schema";
import type { ServiceResult } from "@/lib/abm/types";
import { isClienteActivo } from "@/lib/abm/cliente-estado";
import { todayInBuenosAires } from "@/lib/horas/dates";
import { writeXlsx } from "@/lib/xlsx/write";
import { mesCompacto, resolverPeriodo, type Periodo } from "../periodo";
import { calcularPorProyecto, type PorProyectoData } from "../por-proyecto";
import { calcularResultados, type ResultadosData } from "../resultados";
import { calcularSaldos, type SaldosData } from "../saldos";
import { calcularSocios, type SociosData } from "../socios";
import { nombreArchivo, REPORTES, vistaToSheet, type ReporteSlug } from "../excel";
import { vistaPorProyecto, vistaResultados, vistaSaldos, vistaSocios, type Vista } from "../vista";
import { cargarComprobantes, cargarHoras, cargarMovimientos, cargarPrimerMes } from "./load";

/**
 * Reportes (Admin): lee la base una vez por request, calcula con las funciones puras de
 * lib/reportes y arma la vista que usan la pantalla y la descarga Excel.
 */

export type ReporteData = ResultadosData | PorProyectoData | SociosData | SaldosData;

export interface Reporte {
  slug: ReporteSlug;
  data: ReporteData;
  vista: Vista;
  /** AAAAMM del nombre del archivo: mes inicial (Saldos: mes de la descarga). */
  archivoMes: string;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function periodo(desde: string | null, now: Date): Promise<{ periodo: Periodo; aviso: string | null } | { error: string }> {
  return resolverPeriodo(desde, await cargarPrimerMes(), todayInBuenosAires(now));
}

async function resultados(desde: string | null, now: Date): Promise<ServiceResult<ResultadosData>> {
  const p = await periodo(desde, now);
  if ("error" in p) return { ok: false, status: 400, error: p.error };
  const [ventas, compras, tes] = await Promise.all([cargarComprobantes("ventas"), cargarComprobantes("compras"), cargarMovimientos()]);
  const categorias = ventas.contexto.ctx.categorias.map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo }));
  return { ok: true, data: calcularResultados(p.periodo, categorias, [...ventas.items, ...compras.items], tes.items, p.aviso) };
}

async function porProyecto(desde: string | null, now: Date): Promise<ServiceResult<PorProyectoData>> {
  const p = await periodo(desde, now);
  if ("error" in p) return { ok: false, status: 400, error: p.error };
  const [ventas, compras, tes, horas] = await Promise.all([cargarComprobantes("ventas"), cargarComprobantes("compras"), cargarMovimientos(), cargarHoras(p.periodo)]);
  const ctx = ventas.contexto.ctx;
  const refs = {
    unidades: ctx.unidades,
    proyectos: ctx.proyectos.map((x) => ({ id: x.id, codigo: x.codigo, cliente: x.cliente?.id ?? null, unidadNegocio: x.unidadNegocio })),
    clientes: ventas.contexto.contrapartes,
  };
  return { ok: true, data: calcularPorProyecto(p.periodo, refs, [...ventas.items, ...compras.items], tes.items, horas, p.aviso) };
}

async function socios(desde: string | null, now: Date): Promise<ServiceResult<SociosData>> {
  const p = await periodo(desde, now);
  if ("error" in p) return { ok: false, status: 400, error: p.error };
  const S = TABLES.socios.fields;
  const [compras, tes, rows] = await Promise.all([
    cargarComprobantes("compras"),
    cargarMovimientos(),
    getAirtableClient().list(TABLES.socios.id, { fields: [S.sigla, S.nombre, S.porcentajeRetiros] }),
  ]);
  const lista = rows.map((r) => ({
    id: r.id,
    sigla: text(r.fields[S.sigla]) || "(sin sigla)",
    nombre: text(r.fields[S.nombre]),
    porcentaje: typeof r.fields[S.porcentajeRetiros] === "number" ? (r.fields[S.porcentajeRetiros] as number) : 0,
  }));
  return { ok: true, data: calcularSocios(p.periodo, lista, tes.ctx.tipos, compras.items, tes.items, p.aviso) };
}

async function saldos(now: Date): Promise<ServiceResult<SaldosData>> {
  const CL = TABLES.clientes.fields;
  const [ventas, compras, tes, clientes] = await Promise.all([
    cargarComprobantes("ventas"),
    cargarComprobantes("compras"),
    cargarMovimientos(),
    getAirtableClient().list(TABLES.clientes.id, { fields: [CL.nombre, CL.sigla, CL.estado] }),
  ]);
  const refs = {
    cuentas: tes.ctx.cuentas,
    clientes: clientes.map((r) => ({ id: r.id, nombre: text(r.fields[CL.nombre]) || "(sin nombre)", sigla: text(r.fields[CL.sigla]), activo: isClienteActivo(r.fields[CL.estado]) })),
    proveedores: [...compras.contexto.byId.proveedores].map(([id, x]) => ({ id, nombre: x.nombre })),
    tipos: tes.ctx.tipos,
  };
  return { ok: true, data: calcularSaldos(todayInBuenosAires(now), refs, [...ventas.items, ...compras.items], tes.items) };
}

/** Calcula un reporte y su vista. `desde` = "AAAA-MM" de la URL (null = el del parámetro). */
export async function cargarReporte(slug: ReporteSlug, desde: string | null, now = new Date()): Promise<ServiceResult<Reporte>> {
  switch (slug) {
    case "resultados": {
      const r = await resultados(desde, now);
      return r.ok ? { ok: true, data: { slug, data: r.data, vista: vistaResultados(r.data), archivoMes: mesCompacto(r.data.periodo.desde) } } : r;
    }
    case "resultados-por-proyecto": {
      const r = await porProyecto(desde, now);
      return r.ok ? { ok: true, data: { slug, data: r.data, vista: vistaPorProyecto(r.data), archivoMes: mesCompacto(r.data.periodo.desde) } } : r;
    }
    case "socios": {
      const r = await socios(desde, now);
      return r.ok ? { ok: true, data: { slug, data: r.data, vista: vistaSocios(r.data), archivoMes: mesCompacto(r.data.periodo.desde) } } : r;
    }
    case "saldos": {
      const r = await saldos(now);
      return r.ok ? { ok: true, data: { slug, data: r.data, vista: vistaSaldos(r.data), archivoMes: mesCompacto(r.data.hoy.slice(0, 7)) } } : r;
    }
  }
}

/** El mismo reporte como .xlsx (desde la misma vista). */
export function reporteXlsx(r: Reporte): { bytes: Buffer; filename: string } {
  return { bytes: writeXlsx(vistaToSheet(r.vista, REPORTES[r.slug].hoja)), filename: nombreArchivo(r.slug, r.archivoMes) };
}
