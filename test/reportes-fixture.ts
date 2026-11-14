/**
 * Datos sintéticos para los tests de lib/reportes. Cada comprobante y movimiento pasa
 * por las reglas reales (evaluarComprobante, evaluarMovimiento, recordHours), como en
 * el servidor. Los valores esperados se calcularon a mano en los tests (centavos).
 *
 * Período de referencia: desde 2026-02 (feb-2026 … ene-2027).
 */
import { recordHours } from "@/lib/horas/time";
import { aComprobanteR, aMovimientoR } from "@/lib/reportes/normalizar";
import type { HoraR } from "@/lib/reportes/types";
import { evaluarMovimiento, type MovimientoDatos, type TesoreriaCtx } from "@/lib/tesoreria/rules";
import { evaluarComprobante, type ComprobanteGuardado, type RefsListado } from "@/lib/ventas-compras/listado";
import type { Contexto } from "@/lib/ventas-compras/types";

export const ID = {
  ing1: "recCATING1000000A",
  ing2: "recCATING2000000B",
  gas1: "recCATGAS1000000C",
  gas2: "recCATGAS2000000D",
  gas3: "recCATGAS3000000E",
  una: "recUNIDADA0000000",
  unb: "recUNIDADB0000000",
  p1: "recPROYECTO1000000",
  p2: "recPROYECTO2000000",
  cli1: "recCLIENTE1000000",
  cli2: "recCLIENTE2000000",
  cli3: "recCLIENTE3000000",
  cli4: "recCLIENTE4000000",
  prov1: "recPROVEEDOR10000",
  prov2: "recPROVEEDOR20000",
  prov3: "recPROVEEDOR30000",
  s1: "recSOCIO100000000",
  s2: "recSOCIO200000000",
  ars: "recCUENTAARS00000",
  ars2: "recCUENTAARS20000",
  usd: "recCUENTAUSD00000",
  cobro: "recTIPOCOBRO00000",
  pago: "recTIPOPAGO000000",
  banc: "recTIPOBANC000000",
  isc: "recTIPOISC0000000",
  ret: "recTIPORET0000000",
  gps: "recTIPOGPS0000000",
  apo: "recTIPOAPO0000000",
  trf: "recTIPOTRF0000000",
} as const;

export const CUIT1 = "30711111118";

export const categorias = [
  { id: ID.ing1, nombre: "Ingresos por servicios", tipo: "Ingreso" },
  { id: ID.ing2, nombre: "Otros ingresos", tipo: "Ingreso" },
  { id: ID.gas1, nombre: "Gastos varios", tipo: "Gasto" },
  { id: ID.gas2, nombre: "Honorarios", tipo: "Gasto" },
  { id: ID.gas3, nombre: "Alquileres", tipo: "Gasto" },
];

const ctx: Contexto = {
  proyectos: [
    { id: ID.p1, codigo: "QA - Web", activo: true, cliente: { id: ID.cli1, nombre: "QA Cliente Uno" }, unidadNegocio: ID.una },
    { id: ID.p2, codigo: "QA - App", activo: false, cliente: { id: ID.cli2, nombre: "QA Cliente Dos" }, unidadNegocio: null },
  ],
  unidades: [
    { id: ID.una, nombre: "Consultoría" },
    { id: ID.unb, nombre: "Software" },
  ],
  categorias: categorias.map((c) => ({ ...c, requiereProyecto: false })),
  socios: [
    { id: ID.s1, nombre: "LR · Luciano" },
    { id: ID.s2, nombre: "SK · Socia" },
  ],
  categoriaVentasPorDefecto: { nombre: "Ingresos por servicios", id: ID.ing1 },
};

const refs: RefsListado = {
  tipos: new Map([
    ["recTIPOFACTC00000", { codigo: 11, signo: 1 }],
    ["recTIPONCC0000000", { codigo: 13, signo: -1 }],
    ["recTIPOFACTA00000", { codigo: 1, signo: 1 }],
  ]),
  clientesPorCuit: new Map([[CUIT1, { id: ID.cli1, nombre: "QA Cliente Uno" }]]),
  proveedores: new Map([
    [ID.prov1, { nombre: "QA Proveedor Uno", cuit: "30733333334", categoriaPorDefecto: ID.gas1 }],
    [ID.prov2, { nombre: "QA Proveedor Dos", cuit: "30744444447", categoriaPorDefecto: null }],
    [ID.prov3, { nombre: "QA Proveedor Tres", cuit: "30755555550", categoriaPorDefecto: null }],
  ]),
};

let seq = 0;
function comp(fecha: string, datos: Record<string, string | number | null>, over: Partial<ComprobanteGuardado> = {}): ComprobanteGuardado {
  seq++;
  return {
    id: `recCOMP${String(seq).padStart(10, "0")}`,
    clave: `x|${seq}`,
    tipoComprobanteId: "recTIPOFACTC00000",
    mesDevengado: null,
    proyecto: null,
    unidadNegocio: null,
    categoria: null,
    socio: null,
    observaciones: "",
    proveedor: null,
    ...over,
    datos: { fecha, nroDocReceptor: CUIT1, impTotal: 0, totalIva: 0, ...datos },
  };
}

const venta = (c: ComprobanteGuardado) => aComprobanteR("ventas", evaluarComprobante("ventas", c, refs, ctx));
const compra = (c: ComprobanteGuardado) => aComprobanteR("compras", evaluarComprobante("compras", c, refs, ctx));

export const ventas = {
  /** Factura C 1.210 (IVA 210) del proyecto Web: neto 1.000, Ingresos por servicios (Parámetro), UN Consultoría. */
  v1: venta(comp("2026-03-10", { impTotal: 1210, totalIva: 210 }, { proyecto: ID.p1 })),
  /** NC 605,50 (IVA 105,50), sin proyecto, cliente por CUIT: neto −500. */
  v2: venta(comp("2026-03-20", { impTotal: 605.5, totalIva: 105.5 }, { tipoComprobanteId: "recTIPONCC0000000" })),
  /** Factura A en USD: 100,01 × TC 1.000,5, IVA 17,36, otros tributos 0,50; categoría de Gasto; sin cliente. */
  v3: venta(
    comp("2026-04-05", { impTotal: 100.01, totalIva: 17.36, otrosTributos: 0.5, tipoCambio: 1000.5, nroDocReceptor: "30799999992" }, { tipoComprobanteId: "recTIPOFACTA00000", categoria: ID.gas2 }),
  ),
  /** Mes 12 del período (ene-2027): incluido. */
  v4: venta(comp("2027-01-31", { impTotal: 100 }, { proyecto: ID.p1, categoria: ID.ing2 })),
  /** Mes 13 (feb-2027): afuera. */
  v5: venta(comp("2027-02-01", { impTotal: 100 })),
  /** Mes anterior al inicio (ene-2026): afuera. */
  v6: venta(comp("2026-01-31", { impTotal: 100 })),
};

export const compras = {
  /** Proveedor con categoría por defecto (Gastos varios), proyecto Web: impacto −1.000. */
  c1: compra(comp("2026-03-15", { impTotal: 1210, totalIva: 210 }, { proveedor: ID.prov1, proyecto: ID.p1 })),
  /** Proveedor sin categoría por defecto y sin categoría: Sin categoría, sin UN ni proyecto. */
  c2: compra(comp("2026-04-10", { impTotal: 500 }, { proveedor: ID.prov2 })),
  /** Imputada al socio LR: impacto 0, a cuenta del socio 300. */
  c3: compra(comp("2026-05-02", { impTotal: 300 }, { proveedor: ID.prov1, socio: ID.s1 })),
  /** Categoría Honorarios elegida; Mes devengado guardado jul-2026 (Fecha jun). */
  c4: compra(comp("2026-06-01", { impTotal: 200 }, { proveedor: ID.prov2, categoria: ID.gas2, mesDevengado: "2026-07-01" })),
};

export const comprobantes = [...Object.values(ventas), ...Object.values(compras)];

export const tesoreriaCtx: TesoreriaCtx = {
  cuentas: [
    { id: ID.ars, nombre: "Banco $", moneda: "ARS", saldoInicial: 1000 },
    { id: ID.usd, nombre: "Banco U$S", moneda: "USD", saldoInicial: 50 },
    { id: ID.ars2, nombre: "Caja $", moneda: "ARS", saldoInicial: 0 },
  ],
  tipos: [
    { id: ID.cobro, nombre: "Cobro a cliente", movimiento: "Cobranza", suma: false, categoriaPorDefecto: null, pideTercero: true, esDeSocio: false },
    { id: ID.pago, nombre: "Pago a proveedor", movimiento: "Pago", suma: false, categoriaPorDefecto: null, pideTercero: true, esDeSocio: false },
    { id: ID.banc, nombre: "Gastos bancarios", movimiento: "Pago", suma: true, categoriaPorDefecto: ID.gas1, pideTercero: false, esDeSocio: false },
    { id: ID.isc, nombre: "Ingreso sin comprobante", movimiento: "Cobranza", suma: true, categoriaPorDefecto: null, pideTercero: false, esDeSocio: false },
    { id: ID.ret, nombre: "Retiro de socio", movimiento: "Pago", suma: false, categoriaPorDefecto: null, pideTercero: false, esDeSocio: true },
    { id: ID.gps, nombre: "Gasto particular de socio", movimiento: "Pago", suma: false, categoriaPorDefecto: null, pideTercero: false, esDeSocio: true },
    { id: ID.apo, nombre: "Aporte de socio", movimiento: "Cobranza", suma: false, categoriaPorDefecto: null, pideTercero: false, esDeSocio: true },
    { id: ID.trf, nombre: "Transferencia entre cuentas propias", movimiento: "Ambos", suma: false, categoriaPorDefecto: null, pideTercero: false, esDeSocio: false },
  ],
  categorias: categorias.map((c) => ({ id: c.id, nombre: c.nombre })),
  socios: ctx.socios,
  clientes: [],
  proveedores: [],
};

function mov(over: Partial<MovimientoDatos> & Pick<MovimientoDatos, "fecha" | "cuenta" | "movimiento" | "importe" | "tipoOperacion">) {
  const m: MovimientoDatos = { cliente: null, proveedor: null, sumaResultados: null, categoria: null, socio: null, tipoCambio: null, descripcion: "", transferencia: null, ...over };
  return aMovimientoR(m, evaluarMovimiento(m, tesoreriaCtx));
}

export const movs = {
  /** Cobro a cliente (Suma N): Cobrado de QA Cliente Uno. */
  t1: mov({ fecha: "2026-03-25", cuenta: ID.ars, movimiento: "Cobranza", importe: 500, tipoOperacion: ID.cobro, cliente: ID.cli1 }),
  /** Gastos bancarios (Suma S, categoría por defecto Gastos varios): impacto −150,75. */
  t2: mov({ fecha: "2026-03-26", cuenta: ID.ars, movimiento: "Pago", importe: 150.75, tipoOperacion: ID.banc }),
  /** USD: 100,01 × TC 1.000,5 = 100.060,01 en Otros ingresos. */
  t3: mov({ fecha: "2026-04-01", cuenta: ID.usd, movimiento: "Cobranza", importe: 100.01, tipoCambio: 1000.5, tipoOperacion: ID.isc, categoria: ID.ing2 }),
  /** Suma N explícita: impacto 0. */
  t4: mov({ fecha: "2026-04-02", cuenta: ID.ars, movimiento: "Cobranza", importe: 50, tipoOperacion: ID.isc, sumaResultados: "N" }),
  /** Suma S sin categoría: Sin categoría (−70). */
  t5: mov({ fecha: "2026-05-05", cuenta: ID.ars, movimiento: "Cobranza", importe: 70, tipoOperacion: ID.isc }),
  /** Transferencia propia Banco $ → Caja $ (300): impacto 0, cuenta en Saldos. */
  t6: mov({ fecha: "2026-04-15", cuenta: ID.ars, movimiento: "Pago", importe: 300, tipoOperacion: ID.trf, transferencia: "TR-1" }),
  t7: mov({ fecha: "2026-04-15", cuenta: ID.ars2, movimiento: "Cobranza", importe: 300, tipoOperacion: ID.trf, transferencia: "TR-1" }),
  /** Retiro del socio LR (1.000). */
  t8: mov({ fecha: "2026-05-10", cuenta: ID.ars, movimiento: "Pago", importe: 1000, tipoOperacion: ID.ret, socio: ID.s1 }),
  /** Gasto particular de LR, antes del período (histórico). */
  t9: mov({ fecha: "2025-12-01", cuenta: ID.ars, movimiento: "Pago", importe: 200, tipoOperacion: ID.gps, socio: ID.s1 }),
  /** Aporte de la socia SK (400). */
  t10: mov({ fecha: "2026-06-01", cuenta: ID.ars, movimiento: "Cobranza", importe: 400, tipoOperacion: ID.apo, socio: ID.s2 }),
  /** Pago a proveedor (1.000): Pagado de QA Proveedor Uno. */
  t11: mov({ fecha: "2026-04-20", cuenta: ID.ars, movimiento: "Pago", importe: 1000, tipoOperacion: ID.pago, proveedor: ID.prov1 }),
  /** Retiro de SK (1.001). */
  t12: mov({ fecha: "2026-06-02", cuenta: ID.ars, movimiento: "Pago", importe: 1001, tipoOperacion: ID.ret, socio: ID.s2 }),
  /** Cobro a un cliente Inactivo (25) en Caja $. */
  t13: mov({ fecha: "2026-06-10", cuenta: ID.ars2, movimiento: "Cobranza", importe: 25, tipoOperacion: ID.cobro, cliente: ID.cli4 }),
};

export const movimientos = Object.values(movs);

const hora = (proyecto: string, fecha: string, desde: number, hasta: number): HoraR => ({ fecha, proyecto, horas: recordHours(desde, hasta) });
export const horas: HoraR[] = [
  hora(ID.p1, "2026-03-02", 9 * 3600, 12.5 * 3600), // 3,5
  hora(ID.p1, "2026-12-31", 0, 1.5 * 3600), // 1,5 (00:00)
  hora(ID.p1, "2027-02-01", 9 * 3600, 11 * 3600), // mes 13: afuera
  hora(ID.p2, "2026-01-31", 9 * 3600, 10 * 3600), // antes del inicio: afuera
];

export const refsPorProyecto = {
  unidades: ctx.unidades,
  proyectos: ctx.proyectos.map((p) => ({ id: p.id, codigo: p.codigo, cliente: p.cliente?.id ?? null, unidadNegocio: p.unidadNegocio })),
  clientes: [
    { id: ID.cli1, nombre: "QA Cliente Uno" },
    { id: ID.cli2, nombre: "QA Cliente Dos" },
  ],
};

export const socios = [
  { id: ID.s1, sigla: "LR", nombre: "Luciano", porcentaje: 0.6 },
  { id: ID.s2, sigla: "SK", nombre: "Socia", porcentaje: 0.4 },
];

export const refsSaldos = {
  cuentas: tesoreriaCtx.cuentas,
  clientes: [
    { id: ID.cli1, nombre: "QA Cliente Uno", sigla: "QU", activo: true },
    { id: ID.cli2, nombre: "QA Cliente Dos", sigla: "QD", activo: true },
    { id: ID.cli3, nombre: "QA Cliente Inactivo sin movimientos", sigla: "QI", activo: false },
    { id: ID.cli4, nombre: "QA Cliente Inactivo con cobro", sigla: "QC", activo: false },
  ],
  proveedores: [...refs.proveedores].map(([id, p]) => ({ id, nombre: p.nombre })),
  tipos: tesoreriaCtx.tipos,
};
