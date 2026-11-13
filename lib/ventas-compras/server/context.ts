import "server-only";

import { getAirtableClient, type Fields } from "@/lib/airtable/client";
import { TABLES } from "@/lib/airtable/schema";
import { normalizeCuit } from "@/lib/cuit";
import type { Kind } from "../columns";
import type { Referencias } from "../rows";
import type { CategoriaCtx, Contexto, ProyectoCtx, Ref } from "../types";

/** Parámetro (Concepto) con el nombre de la categoría por defecto de Ventas. */
export const PARAM_CATEGORIA_VENTAS = "Categoría por defecto en Ventas";

const T = TABLES;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v));
const first = (v: unknown): string | null => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);
const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
const byNombre = <X extends { nombre: string }>(a: X, b: X) => collator.compare(a.nombre, b.nombre);

export interface ImportContext {
  /** Por ID (listas de comprobantes): tipo → código y signo; proveedor → datos. */
  byId: {
    tipos: ReadonlyMap<string, { codigo: number; signo: number }>;
    proveedores: ReadonlyMap<string, { nombre: string; cuit: string; categoriaPorDefecto: string | null }>;
  };
  /** Opciones de los filtros de las listas: todos los clientes / proveedores, por nombre. */
  contrapartes: Ref[];
  /** Para armar las filas (tipos, clientes y proveedores por CUIT, Claves ARCA existentes). */
  refs: Referencias;
  /** Para las ediciones y el Control (también se manda a la vista previa). */
  ctx: Contexto;
}

/** Todo lo que la importación lee de la base, una vez por request. */
export async function loadImportContext(kind: Kind, options: { claves?: boolean } = {}): Promise<ImportContext> {
  const client = getAirtableClient();
  const table = T[kind];
  const [tipos, proyectos, clientes, unidades, categorias, socios, parametros, proveedores, existentes] = await Promise.all([
    client.list(T.tiposComprobante.id, { fields: [T.tiposComprobante.fields.codigo, T.tiposComprobante.fields.signo] }),
    client.list(T.proyectos.id, { fields: [T.proyectos.fields.codigo, T.proyectos.fields.estado, T.proyectos.fields.cliente, T.proyectos.fields.unidadNegocio] }),
    client.list(T.clientes.id, { fields: [T.clientes.fields.nombre, T.clientes.fields.cuit] }),
    client.list(T.unidadesNegocio.id, { fields: [T.unidadesNegocio.fields.nombre] }),
    client.list(T.categorias.id, { fields: [T.categorias.fields.nombre, T.categorias.fields.tipo, T.categorias.fields.requiereProyecto] }),
    kind === "compras" ? client.list(T.socios.id, { fields: [T.socios.fields.sigla, T.socios.fields.nombre] }) : Promise.resolve([]),
    kind === "ventas" ? client.list(T.parametros.id, { fields: [T.parametros.fields.concepto, T.parametros.fields.valor] }) : Promise.resolve([]),
    kind === "compras"
      ? client.list(T.proveedores.id, { fields: [T.proveedores.fields.nombre, T.proveedores.fields.cuit, T.proveedores.fields.categoriaPorDefecto] })
      : Promise.resolve([]),
    options.claves === false ? Promise.resolve([]) : client.list(table.id, { fields: [table.fields.claveArca] }),
  ]);

  const tiposMap = new Map<number, { id: string; signo: number }>();
  const tiposById = new Map<string, { codigo: number; signo: number }>();
  for (const r of tipos) {
    const codigo = r.fields[T.tiposComprobante.fields.codigo];
    const raw = r.fields[T.tiposComprobante.fields.signo];
    const signo = raw === 1 || raw === -1 ? raw : 0;
    if (typeof codigo === "number") {
      tiposMap.set(codigo, { id: r.id, signo });
      tiposById.set(r.id, { codigo, signo });
    }
  }

  const clienteRef = new Map<string, Ref>(clientes.map((r) => [r.id, { id: r.id, nombre: text(r.fields[T.clientes.fields.nombre]) || "(sin nombre)" }]));
  const clientesPorCuit = new Map<string, Ref>();
  for (const r of clientes) {
    const cuit = normalizeCuit(text(r.fields[T.clientes.fields.cuit]));
    if (cuit.length === 11 && !clientesPorCuit.has(cuit)) clientesPorCuit.set(cuit, clienteRef.get(r.id)!);
  }

  const proveedoresPorCuit = new Map<string, { id: string; nombre: string; categoriaPorDefecto: string | null }>();
  const proveedoresById = new Map<string, { nombre: string; cuit: string; categoriaPorDefecto: string | null }>();
  for (const r of proveedores as { id: string; fields: Fields }[]) {
    const cuit = normalizeCuit(text(r.fields[T.proveedores.fields.cuit]));
    const prov = {
      nombre: text(r.fields[T.proveedores.fields.nombre]) || "(sin nombre)",
      cuit,
      categoriaPorDefecto: first(r.fields[T.proveedores.fields.categoriaPorDefecto]),
    };
    proveedoresById.set(r.id, prov);
    if (cuit.length === 11 && !proveedoresPorCuit.has(cuit)) proveedoresPorCuit.set(cuit, { id: r.id, nombre: prov.nombre, categoriaPorDefecto: prov.categoriaPorDefecto });
  }

  const proyectosCtx: ProyectoCtx[] = proyectos
    .map((r) => {
      const cliente = first(r.fields[T.proyectos.fields.cliente]);
      return {
        id: r.id,
        codigo: text(r.fields[T.proyectos.fields.codigo]) || "(sin código)",
        activo: r.fields[T.proyectos.fields.estado] === "Activo",
        cliente: cliente ? (clienteRef.get(cliente) ?? null) : null,
        unidadNegocio: first(r.fields[T.proyectos.fields.unidadNegocio]),
      };
    })
    .sort((a, b) => collator.compare(a.codigo, b.codigo));

  const categoriasCtx: CategoriaCtx[] = categorias
    .map((r) => ({
      id: r.id,
      nombre: text(r.fields[T.categorias.fields.nombre]) || "(sin nombre)",
      tipo: text(r.fields[T.categorias.fields.tipo]) || null,
      requiereProyecto: r.fields[T.categorias.fields.requiereProyecto] === true,
    }))
    .sort(byNombre);

  const param = (parametros as { id: string; fields: Fields }[]).find((r) => text(r.fields[T.parametros.fields.concepto]) === PARAM_CATEGORIA_VENTAS);
  const paramNombre = param ? text(param.fields[T.parametros.fields.valor]) || null : null;
  const paramCategoria = paramNombre ? categoriasCtx.find((c) => c.nombre.trim().toLowerCase() === paramNombre.toLowerCase()) : undefined;

  const ctx: Contexto = {
    proyectos: proyectosCtx,
    unidades: unidades.map((r) => ({ id: r.id, nombre: text(r.fields[T.unidadesNegocio.fields.nombre]) || "(sin nombre)" })).sort(byNombre),
    categorias: categoriasCtx,
    socios: (socios as { id: string; fields: Fields }[])
      .map((r) => ({ id: r.id, nombre: [text(r.fields[T.socios.fields.sigla]), text(r.fields[T.socios.fields.nombre])].filter(Boolean).join(" · ") || "(sin nombre)" }))
      .sort(byNombre),
    categoriaVentasPorDefecto: { nombre: paramNombre, id: paramCategoria?.id ?? null },
  };

  const clavesExistentes = new Set(existentes.map((r) => text(r.fields[table.fields.claveArca])).filter(Boolean));
  const contrapartes: Ref[] =
    kind === "ventas"
      ? [...clienteRef.values()].sort(byNombre)
      : [...proveedoresById.entries()].map(([id, p]) => ({ id, nombre: p.nombre })).sort(byNombre);
  return {
    refs: { tipos: tiposMap, clientesPorCuit, proveedoresPorCuit, clavesExistentes },
    ctx,
    byId: { tipos: tiposById, proveedores: proveedoresById },
    contrapartes,
  };
}
