import { beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { createFakeAirtable } from "@/test/fake-airtable";

const fake = createFakeAirtable();
vi.mock("@/lib/airtable/client", () => ({ getAirtableClient: () => fake.client }));

const { createMaestro, deleteMaestro, loadMaestro, updateMaestro } = await import("./maestros-service");
const { REFERENCED_MESSAGE } = await import("@/lib/airtable/integrity");
const { sociosSumWarning } = await import("@/lib/abm/maestros");

const C = TABLES.clientes;
const P = TABLES.proyectos;
const CAT = TABLES.categorias;
const UN = TABLES.unidadesNegocio;
const PAR = TABLES.parametros;

const VALID_CUIT = "20-12345678-6";
const VALID_CUIT_2 = "33-69345023-9";

beforeEach(() => {
  fake.reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const seedCliente = (nombre: string, sigla: string | null, estado = "Cliente", extra: Record<string, unknown> = {}) =>
  fake.seed(C.id, { [C.fields.nombre]: nombre, ...(sigla ? { [C.fields.sigla]: sigla } : {}), [C.fields.estado]: estado, ...extra });

const fieldsOf = (tableId: string, id: string) => fake.rows(tableId).find((r) => r.id === id)!.fields;

describe("Clientes · sigla", () => {
  it("Estado Cliente exige sigla de exactamente 2 letras (se pasa a mayúsculas)", async () => {
    expect(await createMaestro("clientes", { nombre: "Acme", estado: "Cliente" })).toMatchObject({
      ok: false,
      status: 400,
      fieldErrors: { sigla: "Un Cliente necesita una sigla de 2 letras." },
    });
    expect(await createMaestro("clientes", { nombre: "Acme", estado: "Cliente", sigla: "ACM" })).toMatchObject({
      fieldErrors: { sigla: "La sigla de un Cliente tiene que tener exactamente 2 letras." },
    });
    const ok = await createMaestro("clientes", { nombre: "Acme", estado: "Cliente", sigla: " ac " });
    expect(ok).toMatchObject({ ok: true });
    expect(fieldsOf(C.id, (ok as { data: { id: string } }).data.id)[C.fields.sigla]).toBe("AC");
  });

  it("un Lead no necesita sigla", async () => {
    expect(await createMaestro("clientes", { nombre: "Prospecto", estado: "Lead" })).toMatchObject({ ok: true });
  });

  it("sigla y nombre únicos (sin distinguir mayúsculas); editar se excluye a sí mismo", async () => {
    const id = seedCliente("Acme", "AC");
    expect(await createMaestro("clientes", { nombre: "Otra", estado: "Cliente", sigla: "ac" })).toMatchObject({
      status: 409,
      fieldErrors: { sigla: expect.stringMatching(/Ya existe/) },
    });
    expect(await createMaestro("clientes", { nombre: "  ACME ", estado: "Lead" })).toMatchObject({
      status: 409,
      fieldErrors: { nombre: expect.stringMatching(/Ya existe/) },
    });
    expect(await updateMaestro("clientes", id, { nombre: "acme", estado: "Cliente", sigla: "AC" })).toMatchObject({ ok: true });
  });

  it("CUIT opcional pero validado si viene; se guarda solo con dígitos", async () => {
    expect(await createMaestro("clientes", { nombre: "X", estado: "Lead", cuit: "20-12345678-5" })).toMatchObject({
      fieldErrors: { cuit: expect.stringMatching(/dígito verificador/) },
    });
    const ok = (await createMaestro("clientes", { nombre: "X", estado: "Lead", cuit: VALID_CUIT })) as { ok: true; data: { id: string } };
    expect(fieldsOf(C.id, ok.data.id)[C.fields.cuit]).toBe("20123456786");
  });
});

describe("Clientes · cascada de Código al cambiar la sigla", () => {
  function setup() {
    const p1 = fake.seed(P.id, { [P.fields.codigo]: "QZ - Prueba", [P.fields.nombreCorto]: "Prueba" });
    const p2 = fake.seed(P.id, { [P.fields.codigo]: "QZ - Web", [P.fields.nombreCorto]: "Web" });
    const cliente = seedCliente("QA", "QZ", "Cliente", { [C.fields.proyectos]: [p1, p2] });
    for (const p of [p1, p2]) fieldsOf(P.id, p)[P.fields.cliente] = [cliente];
    return { cliente, p1, p2 };
  }

  it("recalcula el Código de todos sus proyectos", async () => {
    const { cliente, p1, p2 } = setup();
    expect(await updateMaestro("clientes", cliente, { nombre: "QA", estado: "Cliente", sigla: "QY" })).toMatchObject({ ok: true });
    expect(fieldsOf(P.id, p1)[P.fields.codigo]).toBe("QY - Prueba");
    expect(fieldsOf(P.id, p2)[P.fields.codigo]).toBe("QY - Web");
    expect(fieldsOf(C.id, cliente)[C.fields.sigla]).toBe("QY");
  });

  it("si un Código nuevo choca, rechaza el cambio entero (409) con la lista y no toca nada", async () => {
    const { cliente, p1, p2 } = setup();
    fake.seed(P.id, { [P.fields.codigo]: "QY - Web", [P.fields.nombreCorto]: "Web" }); // de otro cliente
    const res = await updateMaestro("clientes", cliente, { nombre: "QA", estado: "Cliente", sigla: "QY" });
    expect(res).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("QY - Web") });
    expect((res as { error: string }).error).not.toContain("QY - Prueba");
    expect(fieldsOf(C.id, cliente)[C.fields.sigla]).toBe("QZ");
    expect(fieldsOf(P.id, p1)[P.fields.codigo]).toBe("QZ - Prueba");
    expect(fieldsOf(P.id, p2)[P.fields.codigo]).toBe("QZ - Web");
    expect(fake.calls.some((c) => c.method === "update")).toBe(false);
  });

  it("cambiar el Estado a otro que no sea Cliente no toca los proyectos", async () => {
    const { cliente, p1 } = setup();
    expect(await updateMaestro("clientes", cliente, { nombre: "QA", estado: "Ex cliente", sigla: "QZ" })).toMatchObject({ ok: true });
    expect(fieldsOf(P.id, p1)[P.fields.codigo]).toBe("QZ - Prueba");
    expect(fake.calls.filter((c) => c.method === "update" && c.tableId === P.id)).toHaveLength(0);
  });

  it("no se puede quitar la sigla a un cliente con proyectos", async () => {
    const { cliente } = setup();
    expect(await updateMaestro("clientes", cliente, { nombre: "QA", estado: "Lead", sigla: "" })).toMatchObject({ status: 409 });
  });
});

describe("Proyectos · Código y cliente", () => {
  it("el Código lo arma el servidor; uno mandado por el cliente se ignora", async () => {
    const cliente = seedCliente("QA", "QZ");
    const res = (await createMaestro("proyectos", {
      codigo: "HACK - Inyectado",
      nombreCorto: " Prueba ",
      cliente: [cliente],
      estado: "Activo",
    })) as { ok: true; data: { id: string } };
    expect(res.ok).toBe(true);
    expect(fieldsOf(P.id, res.data.id)[P.fields.codigo]).toBe("QZ - Prueba");
    expect(fieldsOf(P.id, res.data.id)[P.fields.cliente]).toEqual([cliente]);
  });

  it("solo clientes con Estado Cliente", async () => {
    const lead = seedCliente("Prospecto", "PR", "Lead");
    expect(await createMaestro("proyectos", { nombreCorto: "X", cliente: [lead], estado: "Activo" })).toMatchObject({
      status: 400,
      fieldErrors: { cliente: "Elegí una opción válida." },
    });
  });

  it("Código único; Estado obligatorio al guardar", async () => {
    const cliente = seedCliente("QA", "QZ");
    fake.seed(P.id, { [P.fields.codigo]: "qz - prueba", [P.fields.nombreCorto]: "prueba" });
    expect(await createMaestro("proyectos", { nombreCorto: "Prueba", cliente: [cliente], estado: "Activo" })).toMatchObject({
      status: 409,
      fieldErrors: { nombreCorto: "Ya existe un proyecto con el código «QZ - Prueba»." },
    });
    expect(await createMaestro("proyectos", { nombreCorto: "Otro", cliente: [cliente] })).toMatchObject({
      status: 400,
      fieldErrors: { estado: "Este campo es obligatorio." },
    });
  });

  it("un proyecto existente sin Estado se lista y tiene que tener Estado al guardarse", async () => {
    const cliente = seedCliente("QA", "QZ");
    const id = fake.seed(P.id, { [P.fields.codigo]: "QZ - Viejo", [P.fields.nombreCorto]: "Viejo", [P.fields.cliente]: [cliente] });
    const data = await loadMaestro("proyectos");
    expect(data.records.find((r) => r.id === id)?.values.estado).toBeNull();
    expect(await updateMaestro("proyectos", id, { nombreCorto: "Viejo", cliente: [cliente] })).toMatchObject({ status: 400 });
    expect(await updateMaestro("proyectos", id, { nombreCorto: "Viejo", cliente: [cliente], estado: "Cerrado" })).toMatchObject({ ok: true });
  });

  it("mantener un cliente que ya no está en Estado Cliente se permite al editar", async () => {
    const ex = seedCliente("Viejo", "VJ", "Ex cliente");
    const id = fake.seed(P.id, { [P.fields.codigo]: "VJ - X", [P.fields.nombreCorto]: "X", [P.fields.cliente]: [ex], [P.fields.estado]: "Activo" });
    expect(await updateMaestro("proyectos", id, { nombreCorto: "X", cliente: [ex], estado: "Cerrado" })).toMatchObject({ ok: true });
  });
});

describe("Proveedores · CUIT", () => {
  it("obligatorio, validado y único (comparando solo dígitos)", async () => {
    expect(await createMaestro("proveedores", { nombre: "Sin CUIT" })).toMatchObject({ fieldErrors: { cuit: "Este campo es obligatorio." } });
    expect(await createMaestro("proveedores", { nombre: "Mal", cuit: "20123456785" })).toMatchObject({
      fieldErrors: { cuit: expect.stringMatching(/dígito verificador/) },
    });
    expect(await createMaestro("proveedores", { nombre: "Corto", cuit: "20-1234" })).toMatchObject({
      fieldErrors: { cuit: "El CUIT tiene que tener 11 dígitos." },
    });
    const first = (await createMaestro("proveedores", { nombre: "Uno", cuit: VALID_CUIT })) as { ok: true; data: { id: string } };
    expect(first.ok).toBe(true);
    expect(await createMaestro("proveedores", { nombre: "Dos", cuit: "20123456786" })).toMatchObject({
      status: 409,
      fieldErrors: { cuit: expect.stringMatching(/Ya existe/) },
    });
    expect(await createMaestro("proveedores", { nombre: "Dos", cuit: VALID_CUIT_2 })).toMatchObject({ ok: true });
    expect(await updateMaestro("proveedores", first.data.id, { nombre: "Uno bis", cuit: VALID_CUIT })).toMatchObject({ ok: true });
  });

  it("categoría por defecto: solo de tipo Gasto", async () => {
    const ingreso = fake.seed(CAT.id, { [CAT.fields.nombre]: "Ventas", [CAT.fields.tipo]: "Ingreso" });
    const gasto = fake.seed(CAT.id, { [CAT.fields.nombre]: "Servicios", [CAT.fields.tipo]: "Gasto" });
    expect(await createMaestro("proveedores", { nombre: "A", cuit: VALID_CUIT, categoriaPorDefecto: [ingreso] })).toMatchObject({
      fieldErrors: { categoriaPorDefecto: "Elegí una opción válida." },
    });
    expect(await createMaestro("proveedores", { nombre: "A", cuit: VALID_CUIT, categoriaPorDefecto: [gasto] })).toMatchObject({ ok: true });
    const data = await loadMaestro("proveedores");
    expect(data.options.categoriaPorDefecto.map((o) => o.id)).toEqual([gasto]);
  });
});

describe("Borrado", () => {
  it("bloqueado (409) si tiene referencias, permitido si no", async () => {
    const usada = fake.seed(UN.id, { [UN.fields.nombre]: "Usada", [UN.fields.proyectos]: ["recPPPPPPPPPPPPPP"] });
    const libre = fake.seed(UN.id, { [UN.fields.nombre]: "Libre" });
    expect(await deleteMaestro("unidades-de-negocio", usada)).toEqual({ ok: false, status: 409, error: REFERENCED_MESSAGE });
    expect(REFERENCED_MESSAGE).toBe("No se puede borrar: tiene registros asociados. Desactivalo o dejalo como está.");
    expect(fake.rows(UN.id).some((r) => r.id === usada)).toBe(true);
    expect(await deleteMaestro("unidades-de-negocio", libre)).toEqual({ ok: true, data: { id: libre } });
    expect(fake.rows(UN.id).some((r) => r.id === libre)).toBe(false);
  });

  it("revisa todas las referencias de la tabla (p. ej. Categorías usadas por Tesorería)", async () => {
    const cat = fake.seed(CAT.id, { [CAT.fields.nombre]: "X", [CAT.fields.tipo]: "Gasto", [CAT.fields.tesoreria]: ["recTTTTTTTTTTTTTT"] });
    expect(await deleteMaestro("categorias", cat)).toMatchObject({ status: 409 });
  });

  it("Clientes, Proyectos y Parámetros no se borran", async () => {
    const c = seedCliente("A", "AA");
    expect(await deleteMaestro("clientes", c)).toMatchObject({ status: 405 });
    expect(await deleteMaestro("parametros", "recAAAAAAAAAAAAAA")).toMatchObject({ status: 405 });
    expect(await deleteMaestro("proyectos", "recAAAAAAAAAAAAAA")).toMatchObject({ status: 405 });
  });

  it("inexistente → 404", async () => {
    expect(await deleteMaestro("unidades-de-negocio", "recNOEXISTE000000")).toMatchObject({ status: 404 });
  });
});

describe("Parámetros", () => {
  it("al editar, el Concepto es de solo lectura (se ignora si viene)", async () => {
    const id = fake.seed(PAR.id, { [PAR.fields.concepto]: "Empresa", [PAR.fields.valor]: "Kairos" });
    expect(await updateMaestro("parametros", id, { concepto: "Hackeado", valor: "Kairos SRL" })).toMatchObject({ ok: true });
    expect(fieldsOf(PAR.id, id)).toMatchObject({ [PAR.fields.concepto]: "Empresa", [PAR.fields.valor]: "Kairos SRL" });
    const update = fake.calls.find((c) => c.method === "update")!;
    expect(JSON.stringify(update.payload)).not.toContain(PAR.fields.concepto);
  });

  it("al crear, Concepto obligatorio y único", async () => {
    fake.seed(PAR.id, { [PAR.fields.concepto]: "Empresa" });
    expect(await createMaestro("parametros", { valor: "x" })).toMatchObject({ fieldErrors: { concepto: "Este campo es obligatorio." } });
    expect(await createMaestro("parametros", { concepto: " empresa " })).toMatchObject({ status: 409 });
    expect(await createMaestro("parametros", { concepto: "Nuevo" })).toMatchObject({ ok: true });
  });
});

describe("Otros maestros", () => {
  it("Socios: % se ingresa 0–100 con decimales es-AR y se guarda como decimal", async () => {
    const res = (await createMaestro("socios", { sigla: "lr", porcentajeRetiros: "33,33" })) as { ok: true; data: { id: string } };
    expect(fieldsOf(TABLES.socios.id, res.data.id)).toMatchObject({ [TABLES.socios.fields.sigla]: "LR", [TABLES.socios.fields.porcentajeRetiros]: 0.3333 });
    expect(await createMaestro("socios", { sigla: "XX", porcentajeRetiros: "101" })).toMatchObject({ status: 400 });
  });

  it("Socios: aviso si la suma ≠ 100 % (no es error)", () => {
    expect(sociosSumWarning([0.5, 0.5])).toBeNull();
    expect(sociosSumWarning([0.3333, 0.3333, 0.3334])).toBeNull();
    expect(sociosSumWarning([0.5, 0.3])).toBe("La suma de % retiros es 80 %. Debería ser 100 %.");
    expect(sociosSumWarning([0.5, 0.255])).toBe("La suma de % retiros es 75,5 %. Debería ser 100 %.");
  });

  it("Cuentas: saldo inicial (puede ser negativo) exige fecha", async () => {
    expect(await createMaestro("cuentas", { nombre: "Banco", moneda: "ARS", saldoInicial: "-1.234,56" })).toMatchObject({
      fieldErrors: { fechaSaldoInicial: "Indicá la fecha del saldo inicial." },
    });
    const res = (await createMaestro("cuentas", { nombre: "Banco", moneda: "ARS", saldoInicial: "-1.234,56", fechaSaldoInicial: "01/03/2026" })) as {
      ok: true;
      data: { id: string };
    };
    expect(fieldsOf(TABLES.cuentas.id, res.data.id)).toMatchObject({
      [TABLES.cuentas.fields.saldoInicial]: -1234.56,
      [TABLES.cuentas.fields.fechaSaldoInicial]: "2026-03-01",
    });
  });

  it("Tipos de comprobante: código entero único, signo 1 o -1", async () => {
    fake.seed(TABLES.tiposComprobante.id, { [TABLES.tiposComprobante.fields.codigo]: 11 });
    expect(await createMaestro("tipos-de-comprobante", { codigo: "11", descripcion: "X", signo: "1" })).toMatchObject({ status: 409 });
    expect(await createMaestro("tipos-de-comprobante", { codigo: "1,5", descripcion: "X", signo: "1" })).toMatchObject({ status: 400 });
    expect(await createMaestro("tipos-de-comprobante", { codigo: "12", descripcion: "X", signo: "2" })).toMatchObject({
      fieldErrors: { signo: "Elegí una opción válida." },
    });
    expect(await createMaestro("tipos-de-comprobante", { codigo: "12", descripcion: "X", signo: "-1" })).toMatchObject({ ok: true });
  });

  it("tabla inexistente → 404", async () => {
    expect(await createMaestro("usuarios", {})).toMatchObject({ status: 404 });
  });

  it("las escrituras nunca mandan campos calculados ni de solo lectura", async () => {
    const cliente = seedCliente("QA", "QZ");
    await createMaestro("proyectos", { nombreCorto: "X", cliente: [cliente], estado: "Activo", usuarios: ["recUUUUUUUUUUUUUU"] });
    const create = fake.calls.find((c) => c.method === "create" && c.tableId === P.id)!;
    expect(JSON.stringify(create.payload)).not.toContain(P.fields.usuarios);
  });
});
