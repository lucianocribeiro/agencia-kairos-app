/**
 * Importes de la vista Cliente con las reglas de la Proforma (lib/proforma/proforma.ts):
 * solo horas Facturables (las filtra quien llama), importe por registro con
 * `importeRegistro` (round2(horas × valor hora) en centavos), valor hora y moneda
 * actuales del proyecto, IVA con `ivaDe` y totales por moneda con `totalesPorMoneda`.
 * El neto de cada Colaborador es la suma de los importes de SUS registros, así los
 * netos de los colaboradores suman exactamente el neto del proyecto.
 * Por Estado de facturación (CC-F4-08): mismas reglas sobre el subconjunto de cada estado
 * (neto = Σ importes de sus registros, IVA = ivaDe(neto del estado), total = neto + IVA). Los
 * netos suman exacto el neto del proyecto; los totales pueden diferir en ±0,01 del total del
 * proyecto por el redondeo del IVA (como los IVA por proyecto contra el IVA por moneda). Puro.
 */
import { ESTADO_PENDIENTE, ESTADOS_FACTURACION, type EstadoFacturacion } from "@/lib/horas/estado";
import { sumHours } from "@/lib/horas/time";
import { importeRegistro, ivaDe, totalesPorMoneda, type ProyectoP } from "@/lib/proforma/proforma";
import type { ClienteColaborador, ClienteEstadoImporte, ClienteImporteProyecto, ClienteImportes } from "./types";

export interface HoraCliente {
  proyecto: string;
  colaborador: string | null;
  /** recordHours(desde, hasta). */
  horas: number;
  /** Estado efectivo (vacío en la base = Pendiente; sin valor acá = Pendiente). */
  estado?: EstadoFacturacion;
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

export function calcularImportesCliente(input: {
  /** Proyectos de la vista, en el orden en que se muestran. */
  proyectos: readonly ProyectoP[];
  /** Registros Facturables de esos proyectos, en el período. */
  horas: readonly HoraCliente[];
  /** ID de usuario → Nombre. */
  colaboradores: ReadonlyMap<string, string>;
  alicuota: number;
}): ClienteImportes {
  const { alicuota } = input;
  const proyectos: ClienteImporteProyecto[] = input.proyectos.map((p) => {
    const conValor = p.valorHora !== null && p.moneda !== null;
    const importe = (h: HoraCliente) => (conValor ? importeRegistro(h.horas, p.valorHora!) : 0);
    const propias = input.horas.filter((h) => h.proyecto === p.id);

    const porColaborador = new Map<string, HoraCliente[]>();
    for (const h of propias) {
      const key = h.colaborador ?? "";
      porColaborador.set(key, [...(porColaborador.get(key) ?? []), h]);
    }
    const colaboradores: ClienteColaborador[] = [...porColaborador.entries()]
      .map(([id, filas]) => ({
        nombre: (id && input.colaboradores.get(id)) || "(sin nombre)",
        horas: sumHours(filas.map((f) => f.horas)),
        neto: conValor ? filas.reduce((n, f) => n + importe(f), 0) : null,
      }))
      .sort((a, b) => collator.compare(a.nombre, b.nombre));

    const neto = conValor ? colaboradores.reduce((n, c) => n + c.neto!, 0) : null;
    const iva = neto === null ? null : ivaDe(neto, alicuota);
    // Desglose por estado, en el orden fijo (solo los estados con registros).
    const estados: ClienteEstadoImporte[] = ESTADOS_FACTURACION.flatMap((estado) => {
      const filas = propias.filter((h) => (h.estado ?? ESTADO_PENDIENTE) === estado);
      if (filas.length === 0) return [];
      const n = conValor ? filas.reduce((acc, f) => acc + importe(f), 0) : null;
      const i = n === null ? null : ivaDe(n, alicuota);
      return [{ estado, horas: sumHours(filas.map((f) => f.horas)), neto: n, iva: i, total: n === null ? null : n + i! }];
    });
    return {
      id: p.id,
      codigo: p.codigo,
      // Como en la Proforma: valor hora y moneda se muestran aunque falte el otro (el importe no).
      valorHora: p.valorHora,
      moneda: p.moneda,
      horas: sumHours(propias.map((h) => h.horas)),
      neto,
      iva,
      total: neto === null ? null : neto + iva!,
      colaboradores,
      estados,
    };
  });

  const totales = totalesPorMoneda(
    proyectos.map((p) => ({ moneda: p.moneda, importe: p.neto })),
    alicuota,
  ).map((t) => ({ moneda: t.moneda, neto: t.subtotal, iva: t.iva, total: t.total }));

  return { proyectos, totales };
}
