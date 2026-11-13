import "server-only";

import { getAirtableClient, type Fields } from "@/lib/airtable/client";
import { invalidFieldIds } from "@/lib/airtable/payload";
import { TABLES } from "@/lib/airtable/schema";
import type { RawValues } from "@/lib/abm/fields";
import type { ServiceResult } from "@/lib/abm/types";
import { parseNumberInput } from "@/lib/format";
import { toCents } from "@/lib/ventas-compras/money";
import { shortcutRange, todayInBuenosAires, type DateRange } from "@/lib/horas/dates";
import { resolveRange } from "@/lib/horas/server/write";
import {
  CONTROL,
  evaluarMovimiento,
  ordenSaldo,
  validarMovimiento,
  type CuentaCtx,
  type Evaluacion,
  type MovimientoDatos,
  type Ref,
  type TesoreriaCtx,
  type TipoCtx,
} from "../rules";

/**
 * Tesorería (Admin): lista con saldo corrido por cuenta, alta, edición y borrado de
 * movimientos. Las transferencias propias van por transferencias.ts. Los importes en
 * pesos se calculan en código (lib/tesoreria/rules.ts), nunca se leen de Airtable.
 */

const T = TABLES.tesoreria;
const F = T.fields;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
export const PAGE_SIZE = 50;
export const MAX_FILAS_TESORERIA = 5000;

export const TESORERIA_API_MESSAGES = {
  noEncontrado: "No encontramos el movimiento. Puede que lo hayan borrado.",
  cuenta: "Elegí una cuenta.",
  filtro: "El filtro no es válido.",
  formato: "Los datos no tienen el formato esperado.",
  numero: (campo: string) => `Revisá ${campo}: no es un número válido.`,
  esTransferencia: "Este movimiento es parte de una transferencia entre cuentas propias: editalo o borralo desde la transferencia.",
  demasiados: "El período tiene más de 5.000 movimientos. Elegí un rango de fechas más corto.",
  error: "Ocurrió un error. Probá de nuevo.",
} as const;

const fail = (status: 400 | 404 | 409 | 500 | 503, error: string): ServiceResult<never> => ({ ok: false, status, error });
const first = (v: unknown): string | null => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
const byNombre = (a: Ref, b: Ref) => collator.compare(a.nombre, b.nombre);

// ── Contexto ────────────────────────────────────────────────────────────────

export async function loadTesoreriaCtx(): Promise<TesoreriaCtx> {
  const client = getAirtableClient();
  const C = TABLES.cuentas.fields;
  const O = TABLES.tiposOperacion.fields;
  const [cuentas, tipos, categorias, socios, clientes, proveedores] = await Promise.all([
    client.list(TABLES.cuentas.id, { fields: [C.nombre, C.moneda, C.saldoInicial] }),
    client.list(TABLES.tiposOperacion.id, { fields: [O.nombre, O.movimiento, O.sumaAResultados, O.categoriaPorDefecto, O.pideClienteProveedor, O.esDeSocio] }),
    client.list(TABLES.categorias.id, { fields: [TABLES.categorias.fields.nombre] }),
    client.list(TABLES.socios.id, { fields: [TABLES.socios.fields.sigla, TABLES.socios.fields.nombre] }),
    client.list(TABLES.clientes.id, { fields: [TABLES.clientes.fields.nombre] }),
    client.list(TABLES.proveedores.id, { fields: [TABLES.proveedores.fields.nombre] }),
  ]);
  const ref = (id: string, nombre: unknown): Ref => ({ id, nombre: text(nombre) || "(sin nombre)" });
  return {
    cuentas: cuentas
      .map((r): CuentaCtx => {
        const moneda = r.fields[C.moneda];
        const saldo = r.fields[C.saldoInicial];
        return { id: r.id, nombre: text(r.fields[C.nombre]) || "(sin nombre)", moneda: moneda === "ARS" || moneda === "USD" ? moneda : null, saldoInicial: typeof saldo === "number" ? saldo : 0 };
      })
      .sort(byNombre),
    tipos: tipos
      .map((r): TipoCtx => {
        const mov = r.fields[O.movimiento];
        return {
          id: r.id,
          nombre: text(r.fields[O.nombre]) || "(sin nombre)",
          movimiento: mov === "Cobranza" || mov === "Pago" || mov === "Ambos" ? mov : null,
          suma: r.fields[O.sumaAResultados] === true,
          categoriaPorDefecto: first(r.fields[O.categoriaPorDefecto]),
          pideTercero: r.fields[O.pideClienteProveedor] === true,
          esDeSocio: r.fields[O.esDeSocio] === true,
        };
      })
      .sort(byNombre),
    categorias: categorias.map((r) => ref(r.id, r.fields[TABLES.categorias.fields.nombre])).sort(byNombre),
    socios: socios
      .map((r) => ref(r.id, [text(r.fields[TABLES.socios.fields.sigla]), text(r.fields[TABLES.socios.fields.nombre])].filter(Boolean).join(" · ")))
      .sort(byNombre),
    clientes: clientes.map((r) => ref(r.id, r.fields[TABLES.clientes.fields.nombre])).sort(byNombre),
    proveedores: proveedores.map((r) => ref(r.id, r.fields[TABLES.proveedores.fields.nombre])).sort(byNombre),
  };
}

// ── Registros ───────────────────────────────────────────────────────────────

export const READ_FIELDS = [
  F.numero,
  F.fecha,
  F.cuenta,
  F.movimiento,
  F.importe,
  F.tipoOperacion,
  F.cliente,
  F.proveedor,
  F.sumaResultados,
  F.categoria,
  F.socio,
  F.tipoCambio,
  F.descripcion,
  F.transferencia,
];

export interface MovimientoGuardado extends MovimientoDatos {
  id: string;
  numero: number | null;
}

export function toMovimiento(rec: { id: string; fields: Fields }): MovimientoGuardado {
  const f = rec.fields;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    id: rec.id,
    numero: num(f[F.numero]),
    fecha: typeof f[F.fecha] === "string" ? (f[F.fecha] as string) : null,
    cuenta: first(f[F.cuenta]),
    movimiento: typeof f[F.movimiento] === "string" ? (f[F.movimiento] as string) : null,
    importe: num(f[F.importe]),
    tipoOperacion: first(f[F.tipoOperacion]),
    cliente: first(f[F.cliente]),
    proveedor: first(f[F.proveedor]),
    sumaResultados: typeof f[F.sumaResultados] === "string" ? (f[F.sumaResultados] as string) : null,
    categoria: first(f[F.categoria]),
    socio: first(f[F.socio]),
    tipoCambio: num(f[F.tipoCambio]),
    descripcion: typeof f[F.descripcion] === "string" ? (f[F.descripcion] as string) : "",
    transferencia: text(f[F.transferencia]) || null,
  };
}

/** Movimiento → campos de Airtable (todos los escribibles; vacío = null / []). TC solo en cuentas USD. */
export function toFields(m: MovimientoDatos, cuenta: CuentaCtx | undefined): Fields {
  const link = (id: string | null) => (id ? [id] : []);
  const fields: Fields = {
    [F.fecha]: m.fecha,
    [F.cuenta]: link(m.cuenta),
    [F.movimiento]: m.movimiento,
    [F.importe]: m.importe,
    [F.tipoOperacion]: link(m.tipoOperacion),
    [F.cliente]: link(m.cliente),
    [F.proveedor]: link(m.proveedor),
    [F.sumaResultados]: m.sumaResultados,
    [F.categoria]: link(m.categoria),
    [F.socio]: link(m.socio),
    [F.tipoCambio]: cuenta?.moneda === "USD" ? m.tipoCambio : null,
    [F.descripcion]: m.descripcion || null,
  };
  if (m.transferencia) fields[F.transferencia] = m.transferencia;
  return fields;
}

// ── Entrada del formulario ──────────────────────────────────────────────────

export const MOVIMIENTO_INPUT_KEYS = [
  "fecha",
  "cuenta",
  "movimiento",
  "importe",
  "tipoOperacion",
  "cliente",
  "proveedor",
  "sumaResultados",
  "categoria",
  "socio",
  "tipoCambio",
  "descripcion",
] as const;
type MovimientoKey = (typeof MOVIMIENTO_INPUT_KEYS)[number];

const LINK_KEYS = new Set<MovimientoKey>(["cuenta", "tipoOperacion", "cliente", "proveedor", "categoria", "socio"]);

/** RawValues (strings) → parte de MovimientoDatos con solo las claves que vinieron. */
export function parseInput(raw: RawValues, keys: readonly string[] = MOVIMIENTO_INPUT_KEYS): Partial<MovimientoDatos> | { error: string } {
  const out: Partial<MovimientoDatos> = {};
  for (const key of keys as readonly MovimientoKey[]) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (typeof v !== "string") return { error: TESORERIA_API_MESSAGES.formato };
    const s = v.trim();
    if (key === "importe" || key === "tipoCambio") {
      const n = s === "" ? null : parseNumberInput(s);
      if (s !== "" && n === null) return { error: TESORERIA_API_MESSAGES.numero(key === "importe" ? "el importe" : "el tipo de cambio") };
      out[key] = n;
    } else if (LINK_KEYS.has(key)) {
      if (s !== "" && !RECORD_ID_RE.test(s)) return { error: TESORERIA_API_MESSAGES.formato };
      (out as Record<string, unknown>)[key] = s || null;
    } else if (key === "descripcion") out.descripcion = s;
    else (out as Record<string, unknown>)[key] = s || null;
  }
  return out;
}

const VACIO: MovimientoDatos = {
  fecha: null,
  cuenta: null,
  movimiento: null,
  importe: null,
  tipoOperacion: null,
  cliente: null,
  proveedor: null,
  sumaResultados: null,
  categoria: null,
  socio: null,
  tipoCambio: null,
  descripcion: "",
  transferencia: null,
};

/** Para un alta: sin valores vacíos (null, "" o links []). */
export function compact(fields: Fields): Fields {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)));
}

function checkPayload(fields: Fields): boolean {
  const bad = invalidFieldIds(T.id, fields);
  if (bad.length === 0) return true;
  console.error("[tesoreria] Payload inválido (bug del servidor)", { campos: bad });
  return false;
}

export async function createMovimiento(raw: RawValues): Promise<ServiceResult<{ id: string }>> {
  const input = parseInput(raw);
  if ("error" in input) return fail(400, input.error);
  const m: MovimientoDatos = { ...VACIO, ...input };
  const ctx = await loadTesoreriaCtx();
  const error = validarMovimiento(m, ctx);
  if (error) return fail(400, error);
  const fields = compact(toFields(m, ctx.cuentas.find((c) => c.id === m.cuenta)));
  if (!checkPayload(fields)) return fail(500, TESORERIA_API_MESSAGES.error);
  const [created] = await getAirtableClient().create(T.id, [fields], { returnFields: [] });
  return { ok: true, data: { id: created.id } };
}

/**
 * Edita un movimiento: valida el registro completo (lo guardado con lo enviado encima)
 * y escribe solo las claves enviadas (+ TC vacío si la cuenta no es USD). Las
 * transferencias se editan desde su formulario.
 */
export async function updateMovimiento(id: string, raw: RawValues): Promise<ServiceResult<{ id: string }>> {
  if (!RECORD_ID_RE.test(id)) return fail(404, TESORERIA_API_MESSAGES.noEncontrado);
  const record = await getAirtableClient().get(T.id, id, { fields: READ_FIELDS });
  if (!record) return fail(404, TESORERIA_API_MESSAGES.noEncontrado);
  const stored = toMovimiento(record);
  if (stored.transferencia) return fail(409, TESORERIA_API_MESSAGES.esTransferencia);
  const input = parseInput(raw);
  if ("error" in input) return fail(400, input.error);
  const merged: MovimientoDatos = { ...stored, ...input };
  const ctx = await loadTesoreriaCtx();
  const error = validarMovimiento(merged, ctx);
  if (error) return fail(400, error);
  const all = toFields(merged, ctx.cuentas.find((c) => c.id === merged.cuenta));
  const keyToField: Record<MovimientoKey, string> = {
    fecha: F.fecha,
    cuenta: F.cuenta,
    movimiento: F.movimiento,
    importe: F.importe,
    tipoOperacion: F.tipoOperacion,
    cliente: F.cliente,
    proveedor: F.proveedor,
    sumaResultados: F.sumaResultados,
    categoria: F.categoria,
    socio: F.socio,
    tipoCambio: F.tipoCambio,
    descripcion: F.descripcion,
  };
  const fields: Fields = {};
  for (const key of Object.keys(input) as MovimientoKey[]) fields[keyToField[key]] = all[keyToField[key]];
  if (all[F.tipoCambio] === null && stored.tipoCambio !== null) fields[F.tipoCambio] = null;
  if (Object.keys(fields).length === 0) return { ok: true, data: { id } };
  if (!checkPayload(fields)) return fail(500, TESORERIA_API_MESSAGES.error);
  await getAirtableClient().update(T.id, [{ id, fields }], { returnFields: [] });
  return { ok: true, data: { id } };
}

export async function deleteMovimiento(id: string): Promise<ServiceResult<{ id: string }>> {
  if (!RECORD_ID_RE.test(id)) return fail(404, TESORERIA_API_MESSAGES.noEncontrado);
  const record = await getAirtableClient().get(T.id, id, { fields: [F.transferencia] });
  if (!record) return fail(404, TESORERIA_API_MESSAGES.noEncontrado);
  if (text(record.fields[F.transferencia])) return fail(409, TESORERIA_API_MESSAGES.esTransferencia);
  await getAirtableClient().delete(T.id, [id]);
  return { ok: true, data: { id } };
}

// ── Lista ───────────────────────────────────────────────────────────────────

export interface FilaTesoreria extends MovimientoGuardado {
  /** Centavos (moneda de la cuenta / pesos). */
  importeSigno: number;
  importePesos: number | null;
  suma: "S" | "N";
  categoriaEfectiva: Ref | null;
  impacto: number;
  cuentaSocio: number;
  esDeSocio: boolean;
  /** Saldo corrido de la cuenta después de este movimiento (centavos, moneda de la cuenta). */
  saldo: number;
  control: string;
  tipo: Ref | null;
  tercero: Ref | null;
  socioRef: Ref | null;
  /** Transferencia propia: la otra cuenta. */
  otraCuenta: Ref | null;
}

export interface TotalesTesoreria {
  entradas: number;
  salidas: number;
  neto: number;
  pesos: number;
  impacto: number;
  cuentaSocio: number;
}

export interface TesoreriaData {
  cuenta: CuentaCtx;
  range: DateRange;
  filas: FilaTesoreria[];
  cantidad: number;
  pagina: number;
  paginas: number;
  /** Centavos: saldo actual (todos los movimientos), al inicio y al final del período. */
  saldoActual: number;
  saldoInicioPeriodo: number;
  saldoFinPeriodo: number;
  totales: TotalesTesoreria;
  contexto: TesoreriaCtx;
}

export const CONTROL_FILTROS: { value: string; label: string }[] = [
  { value: "ok", label: "OK" },
  { value: "observaciones", label: "Con observaciones" },
  ...(Object.entries(CONTROL) as [string, string | ((m: string) => string)][])
    .filter(([k]) => k !== "ok")
    .map(([k, v]) => ({ value: k, label: typeof v === "function" ? "Este tipo debería ser Cobranza / Pago" : v })),
];

function matchesControl(control: string, filter: string): boolean {
  if (filter === "ok") return control === CONTROL.ok;
  if (filter === "observaciones") return control !== CONTROL.ok;
  if (filter === "tipoDeberiaSer") return control.startsWith("Este tipo debería ser");
  return control === (CONTROL as Record<string, unknown>)[filter];
}

export interface TesoreriaQuery {
  cuenta?: string | null;
  desde?: string | null;
  hasta?: string | null;
  tipo?: string | null;
  movimiento?: string | null;
  control?: string | null;
  pagina?: number | null;
}

const refOf = (list: readonly Ref[], id: string | null): Ref | null => (id ? (list.find((x) => x.id === id) ?? { id, nombre: "(no existe)" }) : null);

/**
 * Lista de una cuenta. Saldo = Saldo inicial (vacío = 0) + Σ importes con signo de todos
 * sus movimientos (moneda de la cuenta), ordenados por Fecha y N°; la Fecha saldo
 * inicial no se usa (regla del Excel). Con un filtro de Fecha, la primera fila incluye
 * todo lo anterior. Los demás filtros no cambian el saldo corrido de cada fila.
 */
export async function listTesoreria(q: TesoreriaQuery, now = new Date()): Promise<ServiceResult<TesoreriaData>> {
  if (!q.cuenta || !RECORD_ID_RE.test(q.cuenta)) return fail(400, TESORERIA_API_MESSAGES.cuenta);
  const today = todayInBuenosAires(now);
  const resolved = !q.desde && !q.hasta ? { range: shortcutRange("anioActual", today) } : resolveRange(q.desde ?? null, q.hasta ?? null, today);
  if ("error" in resolved) return fail(400, resolved.error);
  if (q.tipo && !RECORD_ID_RE.test(q.tipo)) return fail(400, TESORERIA_API_MESSAGES.filtro);
  if (q.movimiento && q.movimiento !== "Cobranza" && q.movimiento !== "Pago") return fail(400, TESORERIA_API_MESSAGES.filtro);
  if (q.control && !CONTROL_FILTROS.some((c) => c.value === q.control)) return fail(400, TESORERIA_API_MESSAGES.filtro);
  const pagina = q.pagina ?? 1;
  if (!Number.isInteger(pagina) || pagina < 1) return fail(400, TESORERIA_API_MESSAGES.filtro);
  const { range } = resolved;

  const [ctx, records] = await Promise.all([loadTesoreriaCtx(), getAirtableClient().list(T.id, { fields: READ_FIELDS })]);
  const cuenta = ctx.cuentas.find((c) => c.id === q.cuenta);
  if (!cuenta) return fail(400, TESORERIA_API_MESSAGES.cuenta);
  const todos = records.map(toMovimiento);
  const deLaCuenta = todos.filter((m) => m.cuenta === cuenta.id);
  const enRango = deLaCuenta.filter((m) => m.fecha !== null && m.fecha >= range.desde && m.fecha <= range.hasta);
  if (enRango.length > MAX_FILAS_TESORERIA) return fail(400, TESORERIA_API_MESSAGES.demasiados);

  // Pares de transferencias: ID → registros (de todas las cuentas). Completo = un Pago y una Cobranza.
  const pares = new Map<string, MovimientoGuardado[]>();
  for (const m of todos) if (m.transferencia) pares.set(m.transferencia, [...(pares.get(m.transferencia) ?? []), m]);
  const incompleto = (m: MovimientoGuardado) => {
    if (!m.transferencia) return false;
    const par = pares.get(m.transferencia) ?? [];
    return !(par.length === 2 && par.some((x) => x.movimiento === "Pago") && par.some((x) => x.movimiento === "Cobranza"));
  };
  const evaluated = new Map<string, Evaluacion>(deLaCuenta.map((m) => [m.id, evaluarMovimiento(m, ctx, { parIncompleto: incompleto(m) })]));
  const ordenados = [...deLaCuenta].sort(ordenSaldo);
  let saldo = toCents(cuenta.saldoInicial);
  let saldoInicioPeriodo = saldo;
  let saldoFinPeriodo = saldo;
  const saldoDe = new Map<string, number>();
  for (const m of ordenados) {
    saldo += evaluated.get(m.id)!.importeSigno;
    saldoDe.set(m.id, saldo);
    if (m.fecha === null || m.fecha < range.desde) saldoInicioPeriodo = saldo;
    if (m.fecha === null || m.fecha <= range.hasta) saldoFinPeriodo = saldo;
  }
  const saldoActual = saldo;

  const filas = enRango
    .filter((m) => (!q.tipo || m.tipoOperacion === q.tipo) && (!q.movimiento || m.movimiento === q.movimiento))
    .map((m): FilaTesoreria => {
      const ev = evaluated.get(m.id)!;
      const otra = m.transferencia ? pares.get(m.transferencia)?.find((x) => x.id !== m.id) : undefined;
      const terceroId = m.cliente ?? m.proveedor;
      return {
        ...m,
        importeSigno: ev.importeSigno,
        importePesos: ev.importePesos,
        suma: ev.suma,
        categoriaEfectiva: refOf(ctx.categorias, ev.categoria),
        impacto: ev.impacto,
        cuentaSocio: ev.cuentaSocio,
        esDeSocio: ev.esDeSocio,
        saldo: saldoDe.get(m.id)!,
        control: ev.control,
        tipo: refOf(ctx.tipos, m.tipoOperacion),
        tercero: terceroId ? refOf(m.cliente ? ctx.clientes : ctx.proveedores, terceroId) : null,
        socioRef: refOf(ctx.socios, m.socio),
        otraCuenta: otra ? (refOf(ctx.cuentas, otra.cuenta) ?? null) : null,
      };
    })
    .filter((f) => !q.control || matchesControl(f.control, q.control))
    .sort(ordenSaldo);

  const totales: TotalesTesoreria = { entradas: 0, salidas: 0, neto: 0, pesos: 0, impacto: 0, cuentaSocio: 0 };
  for (const f of filas) {
    if (f.importeSigno > 0) totales.entradas += f.importeSigno;
    else totales.salidas += -f.importeSigno;
    totales.neto += f.importeSigno;
    totales.pesos += f.importePesos ?? 0;
    totales.impacto += f.impacto;
    totales.cuentaSocio += f.cuentaSocio;
  }
  const paginas = Math.max(1, Math.ceil(filas.length / PAGE_SIZE));
  const page = Math.min(pagina, paginas);
  return {
    ok: true,
    data: {
      cuenta,
      range,
      filas: filas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      cantidad: filas.length,
      pagina: page,
      paginas,
      saldoActual,
      saldoInicioPeriodo,
      saldoFinPeriodo,
      totales,
      contexto: ctx,
    },
  };
}
