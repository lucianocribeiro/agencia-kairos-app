/**
 * Reglas de Tesorería (de Gestion_Kairos_ERP_v4.xlsx), en código. Client-safe: las
 * mismas funciones validan el formulario, calculan el Control y arman las listas. No
 * se leen las fórmulas de Airtable (Entra/Sale, Importe $).
 */
import { isIsoDate } from "@/lib/horas/dates";
import { toCents } from "@/lib/ventas-compras/money";

export type Movimiento = "Cobranza" | "Pago";
export const MOVIMIENTOS: readonly Movimiento[] = ["Cobranza", "Pago"];
export type Suma = "S" | "N";

/** Nombre del tipo de operación de las transferencias propias (solo por el formulario de transferencia). */
export const TIPO_TRANSFERENCIA = "Transferencia entre cuentas propias";

export interface Ref {
  id: string;
  nombre: string;
}

export interface CuentaCtx {
  id: string;
  nombre: string;
  moneda: "ARS" | "USD" | null;
  /** Vacío = 0. */
  saldoInicial: number;
}

export interface TipoCtx {
  id: string;
  nombre: string;
  movimiento: "Cobranza" | "Pago" | "Ambos" | null;
  suma: boolean;
  categoriaPorDefecto: string | null;
  pideTercero: boolean;
  esDeSocio: boolean;
}

export interface TesoreriaCtx {
  cuentas: CuentaCtx[];
  tipos: TipoCtx[];
  categorias: Ref[];
  socios: Ref[];
  clientes: Ref[];
  proveedores: Ref[];
}

/** Un movimiento por clave (no por ID de campo). Vacío = null. */
export interface MovimientoDatos {
  fecha: string | null;
  cuenta: string | null;
  movimiento: string | null;
  importe: number | null;
  tipoOperacion: string | null;
  cliente: string | null;
  proveedor: string | null;
  /** "S" | "N" | null (= según el tipo). */
  sumaResultados: string | null;
  categoria: string | null;
  socio: string | null;
  tipoCambio: number | null;
  descripcion: string;
  /** ID de transferencia propia (2 registros) o null. */
  transferencia: string | null;
}

export const CONTROL = {
  /** Red de seguridad: el ID de transferencia no lo comparten exactamente un Pago y una Cobranza. */
  transferenciaIncompleta: "Transferencia incompleta",
  /** Par completo cuyas patas difieren (fecha, importe, TC, descripción) o con cuentas de distinta moneda. */
  transferenciaInconsistente: "Transferencia inconsistente",
  faltaCuenta: "Falta cuenta",
  cuentaInexistente: "Cuenta inexistente",
  movimiento: "Indicá Cobranza o Pago",
  faltaImporte: "Falta importe (positivo)",
  faltaTipo: "Falta tipo de operación",
  tipoInexistente: "Tipo de operación inexistente",
  tipoDeberiaSer: (m: string) => `Este tipo debería ser ${m}`,
  faltaTercero: "Falta cliente / proveedor",
  faltaSocio: "Falta socio",
  socioSoloEn: "Socio sólo en retiros, aportes o gastos particulares",
  socioInexistente: "Socio inexistente",
  faltaCategoria: "Falta categoría",
  categoriaInexistente: "Categoría inexistente",
  faltaTc: "Falta tipo de cambio",
  ok: "OK",
} as const;

// ── Reglas ───────────────────────────────────────────────────────────────────

export const signo = (movimiento: unknown): 1 | -1 | 0 => (movimiento === "Cobranza" ? 1 : movimiento === "Pago" ? -1 : 0);

/** Importe con signo en la moneda de la cuenta, en centavos: +Importe cobranza, −Importe pago. */
export function importeConSigno(m: Pick<MovimientoDatos, "movimiento" | "importe">): number {
  return m.importe === null ? 0 : toCents(m.importe) * signo(m.movimiento) || 0;
}

/** TC aplicado: cuenta ARS → 1; cuenta USD → el Tipo de cambio (null si falta o no es > 0). */
export function tcAplicado(cuenta: CuentaCtx | undefined, tipoCambio: number | null): number | null {
  if (!cuenta || cuenta.moneda !== "USD") return 1;
  return tipoCambio !== null && tipoCambio > 0 ? tipoCambio : null;
}

/** Importe $ = ROUND(Importe con signo × TC; 2), en centavos (ROUND de Excel). null si falta el TC en USD. */
export function importePesos(m: Pick<MovimientoDatos, "movimiento" | "importe" | "tipoCambio">, cuenta: CuentaCtx | undefined): number | null {
  const tc = tcAplicado(cuenta, m.tipoCambio);
  if (tc === null) return null;
  if (m.importe === null) return 0;
  return toCents(m.importe * signo(m.movimiento) * tc) || 0;
}

export interface Evaluacion {
  cuenta: CuentaCtx | null;
  tipo: TipoCtx | null;
  /** Centavos, moneda de la cuenta. */
  importeSigno: number;
  /** Centavos en pesos; null si es USD sin TC. */
  importePesos: number | null;
  esDeSocio: boolean;
  /** Efectiva. */
  suma: Suma;
  /** Efectiva (solo si suma = S). */
  categoria: string | null;
  /** Centavos: Importe $ si suma = S; si no, 0. */
  impacto: number;
  /** Centavos: −Importe $ si es de socio; si no, 0. */
  cuentaSocio: number;
  control: string;
}

const find = <T extends { id: string }>(list: readonly T[], id: string | null) => (id ? (list.find((x) => x.id === id) ?? null) : null);

/**
 * Valores efectivos, importes y Control (primer mensaje que falla, mismo orden que el
 * Excel). `parIncompleto`: el registro tiene ID de transferencia pero ese ID no lo
 * comparten exactamente un Pago y una Cobranza → «Transferencia incompleta» (primero).
 */
export function evaluarMovimiento(m: MovimientoDatos, ctx: TesoreriaCtx, opts: { parIncompleto?: boolean; parInconsistente?: boolean } = {}): Evaluacion {
  const cuenta = find(ctx.cuentas, m.cuenta);
  const tipo = find(ctx.tipos, m.tipoOperacion);
  const esDeSocio = !!tipo?.esDeSocio;
  // Suma a resultados efectiva: socio → N; si no, la del registro; si no, la del tipo.
  const suma: Suma = esDeSocio ? "N" : m.sumaResultados === "S" || m.sumaResultados === "N" ? m.sumaResultados : tipo?.suma ? "S" : "N";
  const categoria = suma === "S" ? (m.categoria ?? tipo?.categoriaPorDefecto ?? null) : null;
  const pesos = importePesos(m, cuenta ?? undefined);
  const tercero = m.movimiento === "Cobranza" ? m.cliente : m.movimiento === "Pago" ? m.proveedor : (m.cliente ?? m.proveedor);

  const checks: [boolean, string][] = [
    [!!m.transferencia && !!opts.parIncompleto, CONTROL.transferenciaIncompleta],
    [!!m.transferencia && !!opts.parInconsistente, CONTROL.transferenciaInconsistente],
    [!m.cuenta, CONTROL.faltaCuenta],
    [!cuenta, CONTROL.cuentaInexistente],
    [m.movimiento !== "Cobranza" && m.movimiento !== "Pago", CONTROL.movimiento],
    [m.importe === null || !(m.importe > 0), CONTROL.faltaImporte],
    [!m.tipoOperacion, CONTROL.faltaTipo],
    [!tipo, CONTROL.tipoInexistente],
    [!!tipo && tipo.movimiento !== "Ambos" && tipo.movimiento !== null && tipo.movimiento !== m.movimiento, CONTROL.tipoDeberiaSer(tipo?.movimiento ?? "")],
    [!!tipo?.pideTercero && !tercero, CONTROL.faltaTercero],
    [esDeSocio && !m.socio, CONTROL.faltaSocio],
    [!!m.socio && !esDeSocio, CONTROL.socioSoloEn],
    [!!m.socio && !find(ctx.socios, m.socio), CONTROL.socioInexistente],
    [suma === "S" && !categoria, CONTROL.faltaCategoria],
    [suma === "S" && !!categoria && !find(ctx.categorias, categoria), CONTROL.categoriaInexistente],
    [cuenta?.moneda === "USD" && !(m.tipoCambio !== null && m.tipoCambio > 0), CONTROL.faltaTc],
  ];
  const control = checks.find(([fails]) => fails)?.[1] ?? CONTROL.ok;

  return {
    cuenta,
    tipo,
    importeSigno: importeConSigno(m),
    importePesos: pesos,
    esDeSocio,
    suma,
    categoria,
    impacto: suma === "S" ? (pesos ?? 0) : 0,
    cuentaSocio: esDeSocio ? -(pesos ?? 0) || 0 : 0,
    control,
  };
}

// ── Transferencias ───────────────────────────────────────────────────────────

type Pata = Pick<MovimientoDatos, "fecha" | "importe" | "tipoCambio" | "descripcion" | "cuenta" | "movimiento">;

/**
 * ¿Las 2 patas de una transferencia son consistentes? Un Pago y una Cobranza con la
 * misma fecha, importe, tipo de cambio y descripción, en cuentas de la misma moneda.
 * `monedaDe` da la moneda de una cuenta (si no se pasa, no se compara la moneda).
 */
export function patasConsistentes(a: Pata, b: Pata, monedaDe?: (cuenta: string | null) => string | null | undefined): boolean {
  const movs = [a.movimiento, b.movimiento].sort().join();
  if (movs !== "Cobranza,Pago") return false;
  if ((a.fecha ?? null) !== (b.fecha ?? null)) return false;
  if ((a.importe ?? null) !== (b.importe ?? null)) return false;
  if ((a.tipoCambio ?? null) !== (b.tipoCambio ?? null)) return false;
  if ((a.descripcion || "") !== (b.descripcion || "")) return false;
  if (monedaDe && (monedaDe(a.cuenta) ?? null) !== (monedaDe(b.cuenta) ?? null)) return false;
  return true;
}

// ── Saldo ────────────────────────────────────────────────────────────────────

/** Orden del saldo: Fecha, después N°. */
export function ordenSaldo<T extends { fecha: string | null; numero: number | null }>(a: T, b: T): number {
  return (a.fecha ?? "").localeCompare(b.fecha ?? "") || (a.numero ?? 0) - (b.numero ?? 0);
}

/**
 * Saldo por cuenta = Saldo inicial (vacío = 0) + Σ importes con signo de TODOS sus
 * movimientos, en la moneda de la cuenta (regla del Excel). La Fecha saldo inicial no
 * se usa. Devuelve el saldo corrido (centavos) después de cada movimiento, en orden.
 */
export function saldoCorrido<T extends { fecha: string | null; numero: number | null; importeSigno: number }>(
  saldoInicial: number,
  movimientos: readonly T[],
): { mov: T; saldo: number }[] {
  let saldo = toCents(saldoInicial);
  return [...movimientos].sort(ordenSaldo).map((mov) => {
    saldo += mov.importeSigno;
    return { mov, saldo };
  });
}

// ── Validación del formulario ────────────────────────────────────────────────

export const TESORERIA_MESSAGES = {
  fecha: "Ingresá una fecha válida.",
  importeDecimales: "El importe admite hasta 2 decimales.",
  tcDecimales: "El tipo de cambio admite hasta 4 decimales.",
  terceroAmbos: "Elegí cliente o proveedor, no los dos.",
  terceroCobranza: "En una cobranza el tercero es un cliente.",
  terceroPago: "En un pago el tercero es un proveedor.",
  clienteInexistente: "El cliente no existe.",
  proveedorInexistente: "El proveedor no existe.",
  categoriaInexistente: "La categoría no existe.",
  suma: "Suma a resultados: S, N o vacío.",
  transferencia: "Las transferencias entre cuentas propias se cargan desde «Transferencia».",
  descripcion: "La descripción no puede superar los 2000 caracteres.",
  mismaCuenta: "Elegí dos cuentas distintas.",
  mismaMoneda: "Las cuentas tienen que ser de la misma moneda.",
} as const;

const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;

/**
 * Errores que impiden guardar un movimiento (formulario y servidor): todo lo que deja
 * el Control distinto de OK, más las reglas del formulario (tercero según el
 * movimiento, nunca los dos, la transferencia solo por su formulario, decimales).
 * Devuelve el primer mensaje o null.
 */
export function validarMovimiento(m: MovimientoDatos, ctx: TesoreriaCtx, opts: { esTransferencia?: boolean } = {}): string | null {
  if (!isIsoDate(m.fecha)) return TESORERIA_MESSAGES.fecha;
  if (m.importe !== null && decimals(m.importe) > 2) return TESORERIA_MESSAGES.importeDecimales;
  if (m.tipoCambio !== null && decimals(m.tipoCambio) > 4) return TESORERIA_MESSAGES.tcDecimales;
  if (m.sumaResultados !== null && m.sumaResultados !== "S" && m.sumaResultados !== "N") return TESORERIA_MESSAGES.suma;
  if (m.descripcion.length > 2000) return TESORERIA_MESSAGES.descripcion;
  const tipo = find(ctx.tipos, m.tipoOperacion);
  if (!opts.esTransferencia && tipo?.nombre === TIPO_TRANSFERENCIA) return TESORERIA_MESSAGES.transferencia;
  if (m.cliente && m.proveedor) return TESORERIA_MESSAGES.terceroAmbos;
  if (m.movimiento === "Cobranza" && m.proveedor) return TESORERIA_MESSAGES.terceroCobranza;
  if (m.movimiento === "Pago" && m.cliente) return TESORERIA_MESSAGES.terceroPago;
  if (m.cliente && !find(ctx.clientes, m.cliente)) return TESORERIA_MESSAGES.clienteInexistente;
  if (m.proveedor && !find(ctx.proveedores, m.proveedor)) return TESORERIA_MESSAGES.proveedorInexistente;
  if (m.categoria && !find(ctx.categorias, m.categoria)) return TESORERIA_MESSAGES.categoriaInexistente;
  const control = evaluarMovimiento(m, ctx).control;
  return control === CONTROL.ok ? null : control;
}
