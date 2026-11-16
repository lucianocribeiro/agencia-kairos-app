/**
 * Reporte «Saldos» (hoja Saldos del Excel), histórico (sin período). Puro; centavos.
 * Cuentas en su propia moneda; Clientes y Proveedores en pesos.
 */
import { TIPOS_OPERACION } from "@/lib/tipos-operacion";
import { toCents } from "@/lib/ventas-compras/money";
import { collator, type ComprobanteR, type MovimientoR } from "./types";

/** Tipos de operación por nombre exacto; los nombres viven en `TIPOS_OPERACION`. */
export const TIPO_COBRO = TIPOS_OPERACION.cobroCliente;
export const TIPO_PAGO = TIPOS_OPERACION.pagoProveedor;

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
  cuentas: FilaCuenta[];
  /** null si falta el tipo `TIPO_COBRO` (ver `errorClientes`). */
  clientes: FilaCliente[] | null;
  ventasSinCliente: number | null;
  errorClientes: string | null;
  /** null si falta el tipo `TIPO_PAGO` (ver `errorProveedores`). */
  proveedores: FilaProveedor[] | null;
  errorProveedores: string | null;
}

export const SALDOS_MESSAGES = {
  faltaCobro: `No encontramos el tipo de operación «${TIPO_COBRO}» en Maestros. Sin ese tipo no se pueden calcular los saldos de clientes.`,
  faltaPago: `No encontramos el tipo de operación «${TIPO_PAGO}» en Maestros. Sin ese tipo no se pueden calcular los saldos de proveedores.`,
} as const;

export function calcularSaldos(
  hoy: string,
  refs: { cuentas: readonly CuentaR[]; clientes: readonly ClienteR[]; proveedores: readonly { id: string; nombre: string }[]; tipos: readonly { id: string; nombre: string }[] },
  comprobantes: readonly ComprobanteR[],
  movimientos: readonly MovimientoR[],
): SaldosData {
  const tipoId = (nombre: string) => refs.tipos.find((t) => t.nombre === nombre)?.id ?? null;
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
  const clientes: FilaCliente[] | null = cobro
    ? [...refs.clientes]
        .sort(byNombre)
        .map((cl) => {
          const facturado = ventas.filter((v) => v.cliente === cl.id).reduce((n, v) => n + v.total, 0);
          const cobrado = movimientos.filter((m) => m.tipo === cobro && m.cliente === cl.id).reduce((n, m) => n + m.importePesos, 0);
          return { fila: { id: cl.id, nombre: cl.nombre, sigla: cl.sigla, facturado: facturado || 0, cobrado: cobrado || 0, saldo: facturado - cobrado || 0 }, activo: cl.activo };
        })
        .filter(({ fila, activo }) => activo || fila.facturado !== 0 || fila.cobrado !== 0)
        .map(({ fila }) => fila)
    : null;
  const ventasSinCliente = cobro ? ventas.filter((v) => !v.cliente).reduce((n, v) => n + v.total, 0) || 0 : null;

  const compras = comprobantes.filter((c) => c.kind === "compras");
  const proveedores: FilaProveedor[] | null = pago
    ? [...refs.proveedores]
        .sort(byNombre)
        .map((p) => {
          const facturado = compras.filter((c) => c.proveedor === p.id).reduce((n, c) => n + c.total, 0);
          const pagado = -movimientos.filter((m) => m.tipo === pago && m.proveedor === p.id).reduce((n, m) => n + m.importePesos, 0);
          return { id: p.id, nombre: p.nombre, facturado: facturado || 0, pagado: pagado || 0, saldo: facturado - pagado || 0 };
        })
        .filter((f) => f.facturado !== 0 || f.pagado !== 0)
    : null;

  return {
    hoy,
    cuentas,
    clientes,
    ventasSinCliente,
    errorClientes: cobro ? null : SALDOS_MESSAGES.faltaCobro,
    proveedores,
    errorProveedores: pago ? null : SALDOS_MESSAGES.faltaPago,
  };
}
