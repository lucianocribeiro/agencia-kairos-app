/**
 * Importes de la vista Cliente con las reglas de la Proforma (lib/proforma/proforma.ts):
 * solo horas Facturables (las filtra quien llama), importe por registro con
 * `importeRegistro` (round2(horas × valor hora) en centavos), valor hora y moneda
 * actuales del proyecto, IVA con `ivaDe` y totales por moneda con `totalesPorMoneda`.
 * El neto de cada Colaborador es la suma de los importes de SUS registros, así los
 * netos de los colaboradores suman exactamente el neto del proyecto. Puro.
 */
import { sumHours } from "@/lib/horas/time";
import { importeRegistro, ivaDe, totalesPorMoneda, type ProyectoP } from "@/lib/proforma/proforma";
import type { ClienteColaborador, ClienteImporteProyecto, ClienteImportes } from "./types";

export interface HoraCliente {
  proyecto: string;
  colaborador: string | null;
  /** recordHours(desde, hasta). */
  horas: number;
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
    };
  });

  const totales = totalesPorMoneda(
    proyectos.map((p) => ({ moneda: p.moneda, importe: p.neto })),
    alicuota,
  ).map((t) => ({ moneda: t.moneda, neto: t.subtotal, iva: t.iva, total: t.total }));

  return { proyectos, totales };
}
