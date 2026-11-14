/**
 * Reporte «Saldos» (hoja Saldos del Excel), histórico (sin período). Puro; centavos.
 * Cuentas en su propia moneda; Clientes y Proveedores en pesos.
 */
import { toCents } from "@/lib/ventas-compras/money";
import { collator, type ComprobanteR, type MovimientoR } from "./types";

export const TIPO_COBRO = "Cobro a cliente";
export const TIPO_PAGO = "Pago a proveedor";

export interface CuentaR {
  id: string;
  nombre: string;
  moneda: string | null;
  /** Vacío = 0. */
  saldoInicial: number;
}

export interface ClienteR {
  id: string;
  nombre: string;
  sigla: string;
  activo: boolean;
}

export interface FilaCuenta {
  id: string;
  nombre: string;
  moneda: string | null;
  /** Centavos, moneda de la cuenta. */
  saldoInicial: number;
  entradas: number;
  salidas: number;
  saldoActual: number;
}

export interface FilaCliente {
  id: string;
  nombre: string;
  sigla: string;
  facturado: number;
  cobrado: number;
  saldo: number;
}

export interface FilaProveedor {
  id: string;
  nombre: string;
  facturado: number;
  pagado: number;
  saldo: number;
}

export interface SaldosData {
  /** Fecha del cálculo ("AAAA-MM-DD"); el nombre del archivo usa su mes. */
  hoy: string;
  avisos: string[];
  cuentas: FilaCuenta[];
  clientes: FilaCliente[];
  ventasSinCliente: number;
  proveedores: FilaProveedor[];
}

export const SALDOS_MESSAGES = {
  faltaTipo: (nombre: string) => `No encontramos el tipo de operación «${nombre}» en Maestros: esa columna queda en 0.`,
} as const;

export function calcularSaldos(
  hoy: string,
  refs: { cuentas: readonly CuentaR[]; clientes: readonly ClienteR[]; proveedores: readonly { id: string; nombre: string }[]; tipos: readonly { id: string; nombre: string }[] },
  comprobantes: readonly ComprobanteR[],
  movimientos: readonly MovimientoR[],
): SaldosData {
  const avisos: string[] = [];
  const tipoId = (nombre: string) => {
    const id = refs.tipos.find((t) => t.nombre === nombre)?.id ?? null;
    if (!id) avisos.push(SALDOS_MESSAGES.faltaTipo(nombre));
    return id;
  };
  const cobro = tipoId(TIPO_COBRO);
  const pago = tipoId(TIPO_PAGO);
  const byNombre = <X extends { nombre: string }>(a: X, b: X) => collator.compare(a.nombre, b.nombre);

  const cuentas: FilaCuenta[] = [...refs.cuentas].sort(byNombre).map((c) => {
    let entradas = 0;
    let salidas = 0;
    for (const m of movimientos) {
      if (m.cuenta !== c.id) continue;
      if (m.importeSigno > 0) entradas += m.importeSigno;
      else salidas -= m.importeSigno;
    }
    const inicial = toCents(c.saldoInicial);
    return { id: c.id, nombre: c.nombre, moneda: c.moneda, saldoInicial: inicial, entradas, salidas: salidas || 0, saldoActual: inicial + entradas - salidas || 0 };
  });

  const ventas = comprobantes.filter((c) => c.kind === "ventas");
  const clientes: FilaCliente[] = [...refs.clientes]
    .sort(byNombre)
    .map((cl) => {
      const facturado = ventas.filter((v) => v.cliente === cl.id).reduce((n, v) => n + v.total, 0);
      const cobrado = cobro ? movimientos.filter((m) => m.tipo === cobro && m.cliente === cl.id).reduce((n, m) => n + m.importePesos, 0) : 0;
      return { fila: { id: cl.id, nombre: cl.nombre, sigla: cl.sigla, facturado: facturado || 0, cobrado: cobrado || 0, saldo: facturado - cobrado || 0 }, activo: cl.activo };
    })
    .filter(({ fila, activo }) => activo || fila.facturado !== 0 || fila.cobrado !== 0)
    .map(({ fila }) => fila);
  const ventasSinCliente = ventas.filter((v) => !v.cliente).reduce((n, v) => n + v.total, 0) || 0;

  const compras = comprobantes.filter((c) => c.kind === "compras");
  const proveedores: FilaProveedor[] = [...refs.proveedores]
    .sort(byNombre)
    .map((p) => {
      const facturado = compras.filter((c) => c.proveedor === p.id).reduce((n, c) => n + c.total, 0);
      const pagado = pago ? -movimientos.filter((m) => m.tipo === pago && m.proveedor === p.id).reduce((n, m) => n + m.importePesos, 0) : 0;
      return { id: p.id, nombre: p.nombre, facturado: facturado || 0, pagado: pagado || 0, saldo: facturado - pagado || 0 };
    })
    .filter((f) => f.facturado !== 0 || f.pagado !== 0);

  return { hoy, avisos, cuentas, clientes, ventasSinCliente, proveedores };
}
