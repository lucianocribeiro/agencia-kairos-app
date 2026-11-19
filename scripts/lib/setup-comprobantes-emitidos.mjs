/**
 * Lógica de `npm run setup:comprobantes-emitidos` (CC-F5-10), con fetch y salida inyectables.
 * Mismo esquema que setup-sincronizaciones-arca.mjs, más los datos maestros de la factura:
 *
 * 1. Clientes: los campos «Razón social» y «Domicilio comercial» (texto).
 * 2. La tabla «Comprobantes emitidos» con sus links a Clientes, Usuarios, Horas, Ventas y a
 *    sí misma (Comprobante asociado, para la futura Nota de Crédito).
 * 3. Parámetros: los Conceptos de la factura (registros con Valor vacío y Descripción).
 *
 * - Si todo existe: verifica tipos/opciones, links, inversos e IDs contra lib/airtable/schema.ts.
 * - `verifyOnly`: solo lee (GET); falta algo → 1, sin crear nada.
 * - Si no: crea lo que falte, imprime los IDs y → 1 ("Actualizá schema.ts…").
 *
 * La tabla nunca guarda certificados, claves privadas ni tokens. Nunca imprime el token.
 */
import { diffTable, fetchBaseTables, schemaTable } from "./schema-ids.mjs";

export const TABLE_NAME = "Comprobantes emitidos";
export const UPDATE_SCHEMA_MESSAGE = "Actualizá schema.ts con estos IDs antes de usar la app.";
const DESCRIPTION =
  "Facturas electrónicas emitidas desde la app (WSFE vía Afip SDK). Lo escribe sólo el servidor. Nunca guarda certificados, claves ni tokens.";
const TIME_ZONE = "America/Argentina/Buenos_Aires";
export const TIPOS = ["Factura A", "Nota de Crédito A"];
export const AMBIENTES = ["Homologación", "Producción"];
export const ESTADOS = ["En proceso", "Autorizada", "Rechazada", "Incierta", "Anulada"];

/** clave en schema.ts → nombre del campo en Airtable */
export const NAMES = {
  comprobante: "Comprobante",
  tipo: "Tipo",
  ambiente: "Ambiente",
  estado: "Estado",
  cliente: "Cliente",
  mes: "Mes",
  usuario: "Usuario",
  puntoVenta: "Punto de venta",
  numero: "Número",
  cae: "CAE",
  vencimientoCae: "Vencimiento CAE",
  fechaEmision: "Fecha de emisión",
  vencimientoPago: "Vencimiento de pago",
  neto: "Neto",
  iva: "IVA",
  total: "Total",
  alicuota: "Alícuota",
  horas: "Horas",
  venta: "Venta",
  comprobanteAsociado: "Comprobante asociado",
  datos: "Datos",
  claveArca: "Clave ARCA",
  mensaje: "Mensaje",
  iniciado: "Iniciado",
  finalizado: "Finalizado",
  corregidoPor: "Corregido por",
};

/** Inverso del link a sí misma (Airtable lo crea como «From field: Comprobante asociado»): se renombra. */
export const SELF_INVERSE_NAME = "Corregido por";

const date = { dateFormat: { name: "european" } };
const dateTime = { dateFormat: { name: "iso" }, timeFormat: { name: "24hour" }, timeZone: TIME_ZONE };
const number = (name, precision) => ({ name, type: "number", options: { precision } });
const select = (name, choices) => ({ name, type: "singleSelect", options: { choices: choices.map((c) => ({ name: c })) } });

/** Campos de la tabla sin los links (el primero es el primario). */
export const FIELDS = [
  { name: "Comprobante", type: "singleLineText", description: "Lo arma el servidor: tipo, número, cliente, mes y ambiente." },
  select("Tipo", TIPOS),
  select("Ambiente", AMBIENTES),
  select("Estado", ESTADOS),
  { name: "Mes", type: "date", options: date, description: "Primer día del mes facturado." },
  number("Punto de venta", 0),
  number("Número", 0),
  { name: "CAE", type: "singleLineText" },
  { name: "Vencimiento CAE", type: "date", options: date },
  { name: "Fecha de emisión", type: "date", options: date },
  { name: "Vencimiento de pago", type: "date", options: date },
  number("Neto", 2),
  number("IVA", 2),
  number("Total", 2),
  number("Alícuota", 4),
  { name: "Datos", type: "multilineText", description: "Snapshot JSON de lo enviado a ARCA: el PDF se arma siempre desde acá." },
  { name: "Clave ARCA", type: "singleLineText", description: "Solo Producción: la Clave ARCA de la Venta (código|PV|número|CUIT). Bloquea borrar esa Venta (CC-F5-12)." },
  { name: "Mensaje", type: "multilineText" },
  { name: "Iniciado", type: "dateTime", options: dateTime },
  { name: "Finalizado", type: "dateTime", options: dateTime },
];

/** Links (se crean después de la tabla). `self` = la propia tabla. */
export function linkFields(ids) {
  const link = (name, linkedTableId, description) => ({ name, type: "multipleRecordLinks", description, options: { linkedTableId } });
  return [
    link("Cliente", ids.clientes, "Cliente facturado."),
    link("Usuario", ids.usuarios, "Admin que emitió."),
    link("Horas", ids.horas, "Horas incluidas (sólo Producción)."),
    link("Venta", ids.ventas, "Registro de Ventas (sólo Producción)."),
    link("Comprobante asociado", ids.self, "Factura que corrige una Nota de Crédito."),
  ];
}

/** Inversos que Airtable crea en otras tablas: clave de schema.ts por tabla. */
export const INVERSES = { clientes: "cliente", usuarios: "usuario", horas: "horas", ventas: "venta" };

/** Campos nuevos de Clientes: clave de schema.ts → nombre. */
export const CLIENTES_FIELDS = { razonSocial: "Razón social", domicilioComercial: "Domicilio comercial" };

/** Conceptos de Parámetros que la factura necesita (Valor vacío; lo carga Luciano). */
export const CONCEPTOS = [
  { concepto: "Domicilio comercial", descripcion: "Domicilio comercial de la empresa (factura electrónica)." },
  { concepto: "Ingresos Brutos", descripcion: "Número de Ingresos Brutos de la empresa (factura electrónica)." },
  { concepto: "Inicio de actividades", descripcion: "Fecha de inicio de actividades de la empresa, con formato AAAA-MM-DD (factura electrónica)." },
  { concepto: "Punto de venta web services", descripcion: "Punto de venta de ARCA habilitado para web services: un entero de 1 a 99999 (factura electrónica)." },
  { concepto: "Leyenda factura A", descripcion: "Leyenda debajo de la letra de la factura A (p. ej. «PAGO EN C.B.U. INFORMADA»). Vacío = sin leyenda." },
];

/** Nombres que la tabla nunca puede tener (secretos). «Clave ARCA» (la de la Venta) no es un secreto. */
export const FORBIDDEN_NAME = /clave(?! arca$)|password|contrase|token|certific|privad|private|\bkey\b|\bsign\b/i;
const COMPUTED = ["formula", "rollup", "lookup", "count", "multipleLookupValues", "autoNumber"];

function verifyShape(table, ids) {
  const problems = [];
  if (table.fields.find((f) => f.id === table.primaryFieldId)?.name !== "Comprobante") problems.push("el campo primario no es Comprobante");
  for (const expected of [...FIELDS, ...linkFields(ids)]) {
    const field = table.fields.find((f) => f.name === expected.name);
    if (!field) continue; // lo reporta diffTable
    if (field.type !== expected.type) problems.push(`${expected.name} es ${field.type}, se esperaba ${expected.type}`);
    for (const want of expected.options?.choices ?? []) {
      if (!(field.options?.choices ?? []).some((c) => c.name === want.name)) problems.push(`${expected.name} no tiene la opción ${want.name}`);
    }
    if (expected.type === "dateTime" && field.options?.timeZone !== TIME_ZONE) problems.push(`${expected.name} no usa la zona ${TIME_ZONE}`);
    if (expected.type === "number" && field.options?.precision !== expected.options.precision) problems.push(`${expected.name} no tiene precisión ${expected.options.precision}`);
    if (expected.type === "multipleRecordLinks" && field.options?.linkedTableId !== expected.options.linkedTableId) problems.push(`${expected.name} no apunta a la tabla esperada`);
  }
  for (const f of table.fields) {
    if (FORBIDDEN_NAME.test(f.name)) problems.push(`el campo «${f.name}» parece guardar un secreto: no puede existir`);
    if (COMPUTED.includes(f.type)) problems.push(`el campo «${f.name}» es calculado (${f.type}): no puede existir`);
  }
  return problems;
}

/** Campo inverso en `other` del link `linkFieldId` (por inverseLinkFieldId, no por nombre). */
function inverseOf(other, table, linkName) {
  const link = table?.fields.find((f) => f.name === linkName);
  if (!other || !link) return null;
  const byId = link.options?.inverseLinkFieldId ? other.fields.find((f) => f.id === link.options.inverseLinkFieldId) : null;
  return byId ?? other.fields.find((f) => f.type === "multipleRecordLinks" && f.options?.inverseLinkFieldId === link.id) ?? null;
}

function idLines(table) {
  return [
    `  tabla ${table.id}`,
    ...table.fields.map((f) => {
      const choices = f.options?.choices ? ` [${f.options.choices.map((c) => c.name).join("|")}]` : "";
      return `  ${f.id}  ${f.name} (${f.type})${choices}`;
    }),
  ];
}

async function request(fetchImpl, method, url, token, body) {
  const res = await fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const type = typeof data.error === "string" ? data.error : data.error?.type;
    throw new Error(`Airtable respondió ${res.status}${type ? ` (${type})` : ""}`);
  }
  return data;
}

/** Conceptos de Parámetros (solo los nombres). */
async function listConceptos(fetchImpl, token, baseId, parametros) {
  const out = [];
  let offset;
  do {
    const qs = new URLSearchParams({ returnFieldsByFieldId: "true", pageSize: "100" });
    qs.append("fields[]", parametros.fields.concepto);
    if (offset) qs.set("offset", offset);
    const data = await request(fetchImpl, "GET", `https://api.airtable.com/v0/${baseId}/${parametros.id}?${qs}`, token);
    for (const r of data.records ?? []) out.push(String(r.fields?.[parametros.fields.concepto] ?? "").trim());
    offset = data.offset;
  } while (offset);
  return out;
}

/**
 * @param {{ token?: string, baseId?: string, verifyOnly?: boolean, fetch?: typeof fetch,
 *           log?: (s: string) => void, error?: (s: string) => void, schemaSource?: string }} options
 * @returns {Promise<0 | 1>}
 */
export async function setupComprobantesEmitidos({ token, baseId, verifyOnly = false, fetch: fetchImpl = fetch, log = console.log, error = console.error, schemaSource }) {
  if (!token || !baseId) {
    error("✖ Faltan AIRTABLE_TOKEN o AIRTABLE_BASE_ID en .env.local.");
    return 1;
  }
  const meta = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
  const ids = {
    clientes: schemaTable("clientes", schemaSource).id,
    usuarios: schemaTable("usuarios", schemaSource).id,
    horas: schemaTable("horas", schemaSource).id,
    ventas: schemaTable("ventas", schemaSource).id,
  };
  const parametros = schemaTable("parametros", schemaSource);

  let tables;
  let conceptos;
  try {
    tables = await fetchBaseTables(token, baseId, fetchImpl);
    conceptos = await listConceptos(fetchImpl, token, baseId, parametros);
  } catch (err) {
    error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const clientes = tables.find((t) => t.id === ids.clientes);
  const existing = tables.find((t) => t.name === TABLE_NAME);
  const faltanClientes = Object.values(CLIENTES_FIELDS).filter((name) => !clientes?.fields.some((f) => f.name === name));
  const faltanConceptos = CONCEPTOS.filter((c) => !conceptos.includes(c.concepto));
  // Campos agregados después de crear la tabla (p. ej. «Clave ARCA», CC-F5-12): se crean si faltan.
  const faltanCampos = existing ? FIELDS.filter((f) => !existing.fields.some((x) => x.name === f.name)) : [];
  const selfInverse = inverseOf(existing, existing, NAMES.comprobanteAsociado);
  const renombrar = existing && selfInverse && selfInverse.name !== SELF_INVERSE_NAME ? selfInverse : null;

  if (existing && faltanClientes.length === 0 && faltanConceptos.length === 0 && faltanCampos.length === 0 && !renombrar) {
    const problems = [];
    let expected = null;
    try {
      expected = schemaTable("comprobantesEmitidos", schemaSource);
    } catch {
      problems.push("lib/airtable/schema.ts no tiene la tabla comprobantesEmitidos");
    }
    problems.push(...verifyShape(existing, { ...ids, self: existing.id }));
    if (!selfInverse) problems.push(`falta el inverso de «${NAMES.comprobanteAsociado}» («${SELF_INVERSE_NAME}»)`);
    if (expected) problems.push(...diffTable(existing, expected, NAMES));
    const clientesSchema = schemaTable("clientes", schemaSource);
    for (const [key, name] of Object.entries(CLIENTES_FIELDS)) {
      const real = clientes.fields.find((f) => f.name === name);
      if (real.type !== "singleLineText") problems.push(`Clientes › ${name} es ${real.type}, se esperaba singleLineText`);
      if (real.id !== clientesSchema.fields[key]) problems.push(`clientes.${key} ("${name}"): real ${real.id} ≠ schema.ts ${clientesSchema.fields[key] ?? "(falta)"}`);
    }
    for (const [tableKey, linkKey] of Object.entries(INVERSES)) {
      const other = tables.find((t) => t.id === ids[tableKey]);
      const inverse = inverseOf(other, existing, NAMES[linkKey]);
      const want = schemaTable(tableKey, schemaSource).fields.comprobantesEmitidos;
      if (!inverse) problems.push(`${tableKey} no tiene el inverso de «${NAMES[linkKey]}»`);
      else if (inverse.id !== want) problems.push(`${tableKey}.comprobantesEmitidos ("${inverse.name}"): real ${inverse.id} ≠ schema.ts ${want ?? "(falta)"}`);
    }
    const lines = [...idLines(existing), ...inverseLines(tables, existing, ids), ...clientesLines(clientes)];
    if (problems.length > 0) {
      error(`✖ ${TABLE_NAME} o los campos de Clientes no coinciden con lib/airtable/schema.ts:`);
      for (const p of problems) error(`  - ${p}`);
      error("IDs reales:");
      for (const line of lines) error(line);
      return 1;
    }
    log(`✔ ${TABLE_NAME}, los campos de Clientes y los Conceptos de Parámetros existen y coinciden con lib/airtable/schema.ts.`);
    for (const line of lines) log(line);
    return 0;
  }

  if (verifyOnly) {
    if (!existing) error(`✖ La tabla ${TABLE_NAME} no existe (modo --verify: no se crea).`);
    for (const f of faltanCampos) error(`✖ ${TABLE_NAME} no tiene el campo «${f.name}» (modo --verify: no se crea).`);
    for (const name of faltanClientes) error(`✖ Clientes no tiene el campo «${name}» (modo --verify: no se crea).`);
    for (const c of faltanConceptos) error(`✖ Parámetros no tiene el Concepto «${c.concepto}» (modo --verify: no se crea).`);
    if (renombrar) error(`✖ El inverso «${renombrar.name}» tiene que llamarse «${SELF_INVERSE_NAME}» (modo --verify: no se renombra).`);
    return 1;
  }

  try {
    for (const [, name] of Object.entries(CLIENTES_FIELDS)) {
      if (faltanClientes.includes(name)) await request(fetchImpl, "POST", `${meta}/${ids.clientes}/fields`, token, { name, type: "singleLineText", description: "Para la factura electrónica." });
    }
    if (!existing) {
      const created = await request(fetchImpl, "POST", meta, token, { name: TABLE_NAME, description: DESCRIPTION, fields: FIELDS });
      for (const link of linkFields({ ...ids, self: created.id })) await request(fetchImpl, "POST", `${meta}/${created.id}/fields`, token, link);
    }
    for (const f of faltanCampos) await request(fetchImpl, "POST", `${meta}/${existing.id}/fields`, token, f);
    if (renombrar) await request(fetchImpl, "PATCH", `${meta}/${existing.id}/fields/${renombrar.id}`, token, { name: SELF_INVERSE_NAME });
    if (faltanConceptos.length > 0) {
      const P = parametros.fields;
      await request(fetchImpl, "POST", `https://api.airtable.com/v0/${baseId}/${parametros.id}`, token, {
        records: faltanConceptos.map((c) => ({ fields: { [P.concepto]: c.concepto, [P.descripcion]: c.descripcion } })),
      });
    }
  } catch (err) {
    error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    error("  Pudo quedar creado una parte: corré el script de nuevo (crea solo lo que falte) y verificá con --verify.");
    return 1;
  }

  let after = tables;
  try {
    after = await fetchBaseTables(token, baseId, fetchImpl);
    // Tabla recién creada: el inverso del link a sí misma se renombra ahora.
    const nueva = after.find((t) => t.name === TABLE_NAME);
    const inv = !existing ? inverseOf(nueva, nueva, NAMES.comprobanteAsociado) : null;
    if (inv && inv.name !== SELF_INVERSE_NAME) {
      await request(fetchImpl, "PATCH", `${meta}/${nueva.id}/fields/${inv.id}`, token, { name: SELF_INVERSE_NAME });
      after = await fetchBaseTables(token, baseId, fetchImpl);
    }
  } catch {
    // se ven con --verify
  }
  const table = after.find((t) => t.name === TABLE_NAME);
  log("Creado. IDs nuevos:");
  for (const line of [...(table ? idLines(table) : []), ...inverseLines(after, table, ids), ...clientesLines(after.find((t) => t.id === ids.clientes))]) log(line);
  for (const c of faltanConceptos) log(`  Parámetros › «${c.concepto}» (Valor vacío)`);
  error(`✖ ${UPDATE_SCHEMA_MESSAGE}`);
  return 1;
}

function inverseLines(tables, table, ids) {
  if (!table) return [];
  return Object.entries(INVERSES).map(([tableKey, linkKey]) => {
    const inv = inverseOf(tables.find((t) => t.id === ids[tableKey]), table, NAMES[linkKey]);
    return inv ? `  ${inv.id}  ${tableKey} › ${inv.name} (inverso de ${NAMES[linkKey]})` : `  (${tableKey}: sin inverso de ${NAMES[linkKey]})`;
  });
}

function clientesLines(clientes) {
  return Object.values(CLIENTES_FIELDS).map((name) => {
    const f = clientes?.fields.find((x) => x.name === name);
    return f ? `  ${f.id}  Clientes › ${name} (${f.type})` : `  (Clientes › ${name} no existe)`;
  });
}
