/**
 * Vista Cliente → tablas (lib/reportes/vista.ts). La pantalla (components/cliente) y la
 * descarga Excel salen de los MISMOS datos (`ClienteHorasData`): la tabla de horas en
 * pantalla es la del dashboard (components/horas) con las mismas filas, y el bloque de
 * importes se dibuja con estas tablas. Un cambio de filas o columnas va acá. Puro.
 */
import { displayDate, GROUPINGS } from "@/lib/horas/dates";
import { toCents } from "@/lib/ventas-compras/money";
import type { Vista, VistaColumna, VistaFila, VistaTabla } from "@/lib/reportes/vista";
import { CLIENTE_MESSAGES, type ClienteHorasData } from "./types";

export const VISTA_CLIENTE_TITULO = "Horas";

const money = (label: string): VistaColumna => ({ label, kind: "money" });

export function tablaHoras(d: ClienteHorasData): VistaTabla {
  return {
    titulo: "Horas por proyecto",
    columnas: [{ label: "Proyecto", kind: "text" }, ...d.buckets.map((b): VistaColumna => ({ label: b.label, kind: "hours" })), { label: "Total", kind: "hours" }],
    filas: [
      ...d.rows.map((r): VistaFila => ({ cells: [r.proyecto.codigo, ...r.values, r.total] })),
      { cells: ["Total", ...d.columnTotals, d.total], total: true },
    ],
  };
}

/** Bloque de importes: por proyecto, detalle por colaborador de cada uno y totales por moneda. */
export function tablasImportes(d: ClienteHorasData): VistaTabla[] {
  if (!d.importes) return [{ titulo: "Importes", columnas: [], filas: [], error: CLIENTE_MESSAGES.importe }];
  const nd = CLIENTE_MESSAGES.noDisponible;
  const porProyecto: VistaTabla = {
    titulo: "Importes por proyecto",
    columnas: [{ label: "Proyecto", kind: "text" }, money("Valor hora"), { label: "Moneda", kind: "text" }, { label: "Horas", kind: "hours" }, money("Neto"), money("IVA"), money("Total")],
    filas: d.importes.proyectos.map(
      (p): VistaFila => ({
        cells:
          p.neto === null
            ? [p.codigo, null, null, p.horas, nd, null, null]
            : [p.codigo, toCents(p.valorHora!), p.moneda, p.horas, p.neto, p.iva, p.total],
      }),
    ),
  };
  const detalle = d.importes.proyectos.map(
    (p): VistaTabla => ({
      titulo: `Detalle por colaborador · ${p.codigo}`,
      columnas: [{ label: "Colaborador", kind: "text" }, { label: "Horas", kind: "hours" }, money(p.moneda ? `Neto (${p.moneda})` : "Neto")],
      filas: [
        ...p.colaboradores.map((c): VistaFila => ({ cells: [c.nombre, c.horas, c.neto ?? nd] })),
        { cells: [`Total ${p.codigo}`, p.horas, p.neto ?? nd], total: true },
      ],
    }),
  );
  const totales: VistaTabla = {
    titulo: "Totales por moneda",
    columnas: [{ label: "Moneda", kind: "text" }, money("Neto"), money("IVA"), money("Total")],
    filas: d.importes.totales.map((t): VistaFila => ({ cells: [t.moneda, t.neto, t.iva, t.total], total: true })),
  };
  return [porProyecto, ...detalle, totales];
}

/** Lo que se exporta: exactamente lo que muestra la pantalla para estos filtros y esta agrupación. */
export function vistaCliente(d: ClienteHorasData): Vista {
  const elegidos = d.rows.map((r) => r.proyecto.codigo);
  return {
    titulo: VISTA_CLIENTE_TITULO,
    lineas: [
      `${displayDate(d.range.desde)} al ${displayDate(d.range.hasta)} · Agrupación ${GROUPINGS[d.grouping].toLowerCase()}`,
      `Proyectos: ${elegidos.join(", ") || "—"}`,
      "Solo horas facturables.",
    ],
    avisos: [],
    error: null,
    tablas: [tablaHoras(d), ...tablasImportes(d)],
  };
}

/** «Horas_<Código o Proyectos>_<AAAA-MM-DD>_<AAAA-MM-DD>.xlsx» (Código con letras, dígitos y guiones). */
export function nombreArchivoCliente(d: ClienteHorasData): string {
  const codigo =
    d.rows.length === 1
      ? d.rows[0].proyecto.codigo
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^A-Za-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "";
  return `Horas_${codigo || "Proyectos"}_${d.range.desde}_${d.range.hasta}.xlsx`;
}
