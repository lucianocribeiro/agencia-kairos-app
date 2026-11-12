import { beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { createFakeAirtable } from "@/test/fake-airtable";

const fake = createFakeAirtable();
vi.mock("@/lib/airtable/client", () => ({ getAirtableClient: () => fake.client }));

const { ABM_MESSAGES, createMaestro, deleteMaestro, loadMaestro, updateMaestro } = await import("./maestros-service");
const { AirtableError } = await import("@/lib/airtable/errors");
const { PROYECTO_MESSAGES } = await import("./maestros-config");
const { REFERENCED_MESSAGE } = await import("@/lib/airtable/integrity");
const { MAESTRO_SPECS, sociosSumWarning } = await import("@/lib/abm/maestros");
const MAESTRO_LABEL = MAESTRO_SPECS.proyectos.fields.find((f) => f.key === "usuarios")!.label;

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

  it("no se puede quitar la sigla a un cliente con proyectos (regla de campo → 400)", async () => {
    const { cliente } = setup();
    expect(await updateMaestro("clientes", cliente, { nombre: "QA", estado: "Lead", sigla: "" })).toMatchObject({
      status: 400,
      fieldErrors: { sigla: PROYECTO_MESSAGES.quitarSigla },
    });
    expect(fake.calls.some((c) => c.method === "update")).toBe(false);
  });

  it("un proyecto sin nombre corto rechaza la cascada (409) sin escribir nada", async () => {
    const { cliente, p1 } = setup();
    delete fieldsOf(P.id, p1)[P.fields.nombreCorto];
    expect(await updateMaestro("clientes", cliente, { nombre: "QA", estado: "Cliente", sigla: "QY" })).toMatchObject({
      status: 409,
      error: expect.stringContaining("QZ - Prueba"),
    });
    expect(fake.calls.some((c) => c.method === "update")).toBe(false);
  });
});

describe("Clientes · cascada atómica (N-01)", () => {
  const N = 25; // 3 lotes de proyectos: 10 + 10 + 5
  const serverError = () => new AirtableError({ code: "server_error", status: 503, message: "falla simulada" });

  function setup() {
    const ids = Array.from({ length: N }, (_, i) => fake.seed(P.id, { [P.fields.codigo]: `QZ - P${i}`, [P.fields.nombreCorto]: `P${i}` }));
    const cliente = seedCliente("QA", "QZ", "Cliente", { [C.fields.proyectos]: ids, [C.fields.contacto]: "Original" });
    const intocable = fake.seed(P.id, { [P.fields.codigo]: "OT - Otro", [P.fields.nombreCorto]: "Otro" });
    return { ids, cliente, intocable };
  }
  const codigos = (ids: string[]) => ids.map((id) => fieldsOf(P.id, id)[P.fields.codigo]);
  const expectNothingChanged = (ids: string[], cliente: string) => {
    expect(codigos(ids)).toEqual(ids.map((_, i) => `QZ - P${i}`));
    expect(fieldsOf(C.id, cliente)).toMatchObject({ [C.fields.sigla]: "QZ", [C.fields.contacto]: "Original" });
  };
  const change = (cliente: string) => updateMaestro("clientes", cliente, { nombre: "QA", estado: "Cliente", sigla: "QY", contacto: "Nuevo" });

  it("éxito: proyectos primero en lotes de ≤10, después el cliente", async () => {
    const { ids, cliente, intocable } = setup();
    expect(await change(cliente)).toMatchObject({ ok: true });
    expect(codigos(ids)).toEqual(ids.map((_, i) => `QY - P${i}`));
    expect(fieldsOf(C.id, cliente)[C.fields.sigla]).toBe("QY");
    expect(fieldsOf(P.id, intocable)[P.fields.codigo]).toBe("OT - Otro");
    const updates = fake.calls.filter((c) => c.method === "update");
    expect(updates.map((c) => c.tableId)).toEqual([P.id, P.id, P.id, C.id]);
    expect(updates.map((c) => (c.payload as unknown[]).length)).toEqual([10, 10, 5, 1]);
  });

  it.each([
    ["el primer lote de proyectos", (call: { tableId: string }, i: number) => call.tableId === P.id && i === 0],
    ["un lote del medio", (call: { tableId: string }, i: number) => call.tableId === P.id && i === 1],
    ["la escritura del cliente", (call: { tableId: string }) => call.tableId === C.id],
  ])("falla en %s → rollback OK → 503 y no queda nada a medias", async (_label, when) => {
    const { ids, cliente } = setup();
    let failed = false;
    fake.failWhen((call, i) => {
      if (failed || call.method !== "update" || !when(call, i)) return false;
      return (failed = true);
    }, serverError());
    expect(await change(cliente)).toEqual({ ok: false, status: 503, error: ABM_MESSAGES.revertido });
    expect(ABM_MESSAGES.revertido).toBe("No pudimos completar el cambio. No se modificó nada; probá de nuevo.");
    expectNothingChanged(ids, cliente);
  });

  it("si el rollback también falla → 500 «quedó incompleto» y se loguean solo los IDs", async () => {
    const { ids, cliente } = setup();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    // Falla la escritura del cliente y todos los updates de rollback de proyectos (los posteriores a los 3 lotes).
    fake.failWhen((call) => call.method === "update" && call.tableId === C.id, serverError());
    fake.failWhen((call, i) => call.method === "update" && call.tableId === P.id && i >= 3, serverError());
    expect(await change(cliente)).toEqual({ ok: false, status: 500, error: ABM_MESSAGES.incompleto });
    expect(ABM_MESSAGES.incompleto).toBe("El cambio quedó incompleto. Avisá a un administrador.");
    const logged = errorLog.mock.calls.find((c) => String(c[0]).includes("INCOMPLETO"));
    expect(logged).toBeDefined();
    expect(logged![1]).toEqual({ ids: expect.arrayContaining([...ids, cliente]) });
    expect(Object.keys(logged![1] as object)).toEqual(["ids"]);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("QY - P");
  });

  it("colisión con otro proyecto → 409 antes de escribir nada", async () => {
    const { ids, cliente } = setup();
    fake.seed(P.id, { [P.fields.codigo]: "qy - p7", [P.fields.nombreCorto]: "p7" });
    expect(await change(cliente)).toMatchObject({ status: 409, error: expect.stringContaining("QY - P7") });
    expect(fake.calls.some((c) => c.method === "update")).toBe(false);
    expectNothingChanged(ids, cliente);
  });

  it("carrera: otro proyecto toma un Código nuevo mientras se escribe → se revierte todo (409)", async () => {
    const { ids, cliente } = setup();
    // Justo antes de escribir el cliente aparece un proyecto con «QY - P3».
    fake.failWhen((call) => {
      if (call.method === "update" && call.tableId === C.id && !fake.rows(P.id).some((r) => r.fields[P.fields.codigo] === "QY - P3" && !ids.includes(r.id))) {
        fake.seed(P.id, { [P.fields.codigo]: "QY - P3", [P.fields.nombreCorto]: "P3" });
      }
      return false;
    });
    expect(await change(cliente)).toMatchObject({ status: 409, error: expect.stringContaining("QY - P3") });
    expectNothingChanged(ids, cliente);
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

  it("cliente sin sigla → 400 (regla de campo); Código duplicado → 409 (choque)", async () => {
    const sinSigla = seedCliente("Viejo", null, "Cliente");
    expect(await createMaestro("proyectos", { nombreCorto: "X", cliente: [sinSigla], estado: "Activo" })).toMatchObject({
      status: 400,
      fieldErrors: { cliente: PROYECTO_MESSAGES.clienteSinSigla },
    });
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

describe("Proyectos · Empleados asignados (N-04)", () => {
  it("solo muestra usuarios con Rol Empleado; un Admin con asignaciones viejas no aparece", async () => {
    const U = TABLES.usuarios.fields;
    const empleado = fake.seed(TABLES.usuarios.id, { [U.nombre]: "Eva", [U.rol]: "Empleado" });
    const admin = fake.seed(TABLES.usuarios.id, { [U.nombre]: "Ana", [U.rol]: "Admin" });
    const cliente = seedCliente("QA", "QZ");
    const id = fake.seed(P.id, { [P.fields.codigo]: "QZ - X", [P.fields.nombreCorto]: "X", [P.fields.cliente]: [cliente], [P.fields.usuarios]: [empleado, admin] });
    const data = await loadMaestro("proyectos");
    expect(MAESTRO_LABEL).toBe("Empleados asignados");
    expect(data.records.find((r) => r.id === id)!.values.usuarios).toEqual([empleado]);
    // El dato en Airtable no se toca.
    expect(fieldsOf(P.id, id)[P.fields.usuarios]).toEqual([empleado, admin]);
  });
});

describe("Unicidad con concurrencia (N-02)", () => {
  it("dos altas simultáneas con el mismo nombre: queda exactamente una", async () => {
    fake.barrier("create", UN.id, 2); // las dos pasan el chequeo previo antes de que exista ninguna
    const results = await Promise.all([createMaestro("unidades-de-negocio", { nombre: "Dup" }), createMaestro("unidades-de-negocio", { nombre: " dup " })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([expect.objectContaining({ status: 409, fieldErrors: { nombre: expect.stringMatching(/Ya existe/) } })]);
    expect(fake.rows(UN.id)).toHaveLength(1);
  });

  it("edición que choca con un alta simultánea: la edición vuelve a su valor anterior", async () => {
    const id = fake.seed(UN.id, { [UN.fields.nombre]: "Viejo" });
    // Simula que el alta entra entre el chequeo previo y la verificación de la edición.
    fake.failWhen((call) => {
      if (call.method === "update" && call.tableId === UN.id && !fake.rows(UN.id).some((r) => r.fields[UN.fields.nombre] === "Nuevo")) {
        fake.seed(UN.id, { [UN.fields.nombre]: "Nuevo" });
      }
      return false;
    });
    expect(await updateMaestro("unidades-de-negocio", id, { nombre: "Nuevo" })).toMatchObject({ status: 409 });
    expect(fieldsOf(UN.id, id)[UN.fields.nombre]).toBe("Viejo");
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
