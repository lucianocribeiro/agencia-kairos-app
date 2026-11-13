import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TABLES } from "@/lib/airtable/schema";
import { createFakeAirtable } from "@/test/fake-airtable";

const fake = createFakeAirtable();
vi.mock("@/lib/airtable/client", () => ({ getAirtableClient: () => fake.client }));

const { ABM_MESSAGES, createMaestro, deleteCheckMaestro, deleteMaestro, loadMaestro, updateMaestro } = await import("./maestros-service");
const { AirtableError } = await import("@/lib/airtable/errors");
const { CLIENTE_MESSAGES, MAESTRO_CONFIGS, PROYECTO_MESSAGES } = await import("./maestros-config");
const { REFERENCED_MESSAGE } = await import("@/lib/airtable/integrity");
const { MAESTRO_MESSAGES, MAESTRO_SPECS, sociosSumWarning } = await import("@/lib/abm/maestros");
const { LEGACY_CLIENTE_ACTIVO, LEGACY_CLIENTE_ESTADOS } = await import("@/lib/abm/cliente-estado");
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

const seedCliente = (nombre: string, sigla: string | null, estado = "Activo", extra: Record<string, unknown> = {}) =>
  fake.seed(C.id, { [C.fields.nombre]: nombre, ...(sigla ? { [C.fields.sigla]: sigla } : {}), [C.fields.estado]: estado, ...extra });

const fieldsOf = (tableId: string, id: string) => fake.rows(tableId).find((r) => r.id === id)!.fields;

describe("Clientes · sigla (F2-01: obligatoria y única para todo cliente)", () => {
  it.each(["Activo", "Inactivo"])("Estado %s exige sigla de exactamente 2 letras (se pasa a mayúsculas)", async (estado) => {
    for (const sigla of [undefined, "", "   "]) {
      expect(await createMaestro("clientes", { nombre: "Acme", estado, ...(sigla === undefined ? {} : { sigla }) })).toMatchObject({
        ok: false,
        status: 400,
        fieldErrors: { sigla: "Este campo es obligatorio." },
      });
    }
    for (const sigla of ["ACM", "A", "A1", "Á B"]) {
      expect(await createMaestro("clientes", { nombre: "Acme", estado, sigla })).toMatchObject({
        status: 400,
        fieldErrors: { sigla: MAESTRO_MESSAGES.clienteSiglaFormato },
      });
    }
    expect(fake.calls.some((c) => c.method === "create")).toBe(false);
    const ok = await createMaestro("clientes", { nombre: "Acme", estado, sigla: " ac " });
    expect(ok).toMatchObject({ ok: true });
    expect(fieldsOf(C.id, (ok as { data: { id: string } }).data.id)).toMatchObject({ [C.fields.sigla]: "AC", [C.fields.estado]: estado });
  });

  it("al editar tampoco se puede dejar sin sigla ni con formato inválido", async () => {
    const id = seedCliente("Acme", "AC", "Inactivo");
    expect(await updateMaestro("clientes", id, { nombre: "Acme", estado: "Inactivo", sigla: "" })).toMatchObject({
      status: 400,
      fieldErrors: { sigla: "Este campo es obligatorio." },
    });
    expect(await updateMaestro("clientes", id, { nombre: "Acme", estado: "Activo", sigla: "ABC" })).toMatchObject({
      status: 400,
      fieldErrors: { sigla: MAESTRO_MESSAGES.clienteSiglaFormato },
    });
    expect(fake.calls.some((c) => c.method === "update")).toBe(false);
  });

  it("solo Estado Activo o Inactivo (las opciones viejas se rechazan)", async () => {
    for (const estado of LEGACY_CLIENTE_ESTADOS) {
      expect(await createMaestro("clientes", { nombre: "Acme", estado, sigla: "AC" })).toMatchObject({ status: 400, fieldErrors: { estado: expect.any(String) } });
    }
  });

  it("sigla y nombre únicos entre Activos e Inactivos (sin distinguir mayúsculas); editar se excluye a sí mismo", async () => {
    const id = seedCliente("Acme", "AC", "Inactivo");
    expect(await createMaestro("clientes", { nombre: "Otra", estado: "Activo", sigla: "ac" })).toMatchObject({
      status: 409,
      fieldErrors: { sigla: expect.stringMatching(/Ya existe/) },
    });
    expect(await createMaestro("clientes", { nombre: "  ACME ", estado: "Inactivo", sigla: "ZZ" })).toMatchObject({
      status: 409,
      fieldErrors: { nombre: expect.stringMatching(/Ya existe/) },
    });
    expect(await updateMaestro("clientes", id, { nombre: "acme", estado: "Activo", sigla: "AC" })).toMatchObject({ ok: true });
  });

  it("carrera de sigla: dos altas con la misma sigla a la vez → pierde la más nueva (409)", async () => {
    fake.barrier("create", C.id, 2); // las dos pasan el chequeo previo antes de que exista ninguna
    const [a, b] = await Promise.all([
      createMaestro("clientes", { nombre: "Uno", estado: "Activo", sigla: "AC" }),
      createMaestro("clientes", { nombre: "Dos", estado: "Inactivo", sigla: "ac" }),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ status: 409, fieldErrors: { sigla: expect.stringMatching(/Ya existe/) } });
    expect(fake.rows(C.id)).toHaveLength(1);
  });

  it("CUIT opcional pero validado si viene; se guarda solo con dígitos", async () => {
    expect(await createMaestro("clientes", { nombre: "X", estado: "Inactivo", sigla: "XX", cuit: "20-12345678-5" })).toMatchObject({
      fieldErrors: { cuit: expect.stringMatching(/dígito verificador/) },
    });
    const ok = (await createMaestro("clientes", { nombre: "X", estado: "Inactivo", sigla: "XX", cuit: VALID_CUIT })) as { ok: true; data: { id: string } };
    expect(fieldsOf(C.id, ok.data.id)[C.fields.cuit]).toBe("20123456786");
  });
});

describe("Clientes · cascada de Código al cambiar la sigla", () => {
  function setup() {
    const p1 = fake.seed(P.id, { [P.fields.codigo]: "QZ - Prueba", [P.fields.nombreCorto]: "Prueba" });
    const p2 = fake.seed(P.id, { [P.fields.codigo]: "QZ - Web", [P.fields.nombreCorto]: "Web" });
    const cliente = seedCliente("QA", "QZ", "Activo", { [C.fields.proyectos]: [p1, p2] });
    for (const p of [p1, p2]) fieldsOf(P.id, p)[P.fields.cliente] = [cliente];
    return { cliente, p1, p2 };
  }

  it("recalcula el Código de todos sus proyectos", async () => {
    const { cliente, p1, p2 } = setup();
    expect(await updateMaestro("clientes", cliente, { nombre: "QA", estado: "Activo", sigla: "QY" })).toMatchObject({ ok: true });
    expect(fieldsOf(P.id, p1)[P.fields.codigo]).toBe("QY - Prueba");
    expect(fieldsOf(P.id, p2)[P.fields.codigo]).toBe("QY - Web");
    expect(fieldsOf(C.id, cliente)[C.fields.sigla]).toBe("QY");
  });

  it("si un Código nuevo choca, rechaza el cambio entero (409) con la lista y no toca nada", async () => {
    const { cliente, p1, p2 } = setup();
    fake.seed(P.id, { [P.fields.codigo]: "QY - Web", [P.fields.nombreCorto]: "Web" }); // de otro cliente
    const res = await updateMaestro("clientes", cliente, { nombre: "QA", estado: "Activo", sigla: "QY" });
    expect(res).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("QY - Web") });
    expect((res as { error: string }).error).not.toContain("QY - Prueba");
    expect(fieldsOf(C.id, cliente)[C.fields.sigla]).toBe("QZ");
    expect(fieldsOf(P.id, p1)[P.fields.codigo]).toBe("QZ - Prueba");
    expect(fieldsOf(P.id, p2)[P.fields.codigo]).toBe("QZ - Web");
    expect(fake.calls.some((c) => c.method === "update")).toBe(false);
  });

  it("pasar a Inactivo sin cambiar la sigla no toca los proyectos", async () => {
    const { cliente, p1 } = setup();
    expect(await updateMaestro("clientes", cliente, { nombre: "QA", estado: "Inactivo", sigla: "QZ" })).toMatchObject({ ok: true });
    expect(fieldsOf(P.id, p1)[P.fields.codigo]).toBe("QZ - Prueba");
    expect(fake.calls.filter((c) => c.method === "update" && c.tableId === P.id)).toHaveLength(0);
  });

  it("no se puede quitar la sigla a un cliente (con o sin proyectos; regla de campo → 400)", async () => {
    const { cliente } = setup();
    expect(await updateMaestro("clientes", cliente, { nombre: "QA", estado: "Inactivo", sigla: "" })).toMatchObject({
      status: 400,
      fieldErrors: { sigla: "Este campo es obligatorio." },
    });
    expect(fake.calls.some((c) => c.method === "update")).toBe(false);
  });

  it("un proyecto sin nombre corto rechaza la cascada (409) sin escribir nada", async () => {
    const { cliente, p1 } = setup();
    delete fieldsOf(P.id, p1)[P.fields.nombreCorto];
    expect(await updateMaestro("clientes", cliente, { nombre: "QA", estado: "Activo", sigla: "QY" })).toMatchObject({
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
    const cliente = seedCliente("QA", "QZ", "Activo", { [C.fields.proyectos]: ids, [C.fields.contacto]: "Original" });
    const intocable = fake.seed(P.id, { [P.fields.codigo]: "OT - Otro", [P.fields.nombreCorto]: "Otro" });
    return { ids, cliente, intocable };
  }
  const codigos = (ids: string[]) => ids.map((id) => fieldsOf(P.id, id)[P.fields.codigo]);
  const expectNothingChanged = (ids: string[], cliente: string) => {
    expect(codigos(ids)).toEqual(ids.map((_, i) => `QZ - P${i}`));
    expect(fieldsOf(C.id, cliente)).toMatchObject({ [C.fields.sigla]: "QZ", [C.fields.contacto]: "Original" });
  };
  const change = (cliente: string) => updateMaestro("clientes", cliente, { nombre: "QA", estado: "Activo", sigla: "QY", contacto: "Nuevo" });

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

  it.each([
    ["deshacer OK → 503", false, 503, ABM_MESSAGES.noVerificado],
    ["deshacer fallido → 500", true, 500, ABM_MESSAGES.incompleto],
  ] as const)("verificación posterior: un proyecto renombrado falta en la relectura, %s (F1-04-01)", async (_l, undoFails, status, error) => {
    const { ids, cliente } = setup();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const written = () => fake.calls.some((c) => c.method === "update" && c.tableId === C.id);
    fake.hide(P.id, (r) => r.id === ids[7] && written());
    if (undoFails) fake.failWhen((call, i) => call.method === "update" && call.tableId === P.id && i >= 3, serverError());
    expect(await change(cliente)).toEqual({ ok: false, status, error });
    const entry = errorLog.mock.calls.find((c) => String(c[0]).includes("Verificación posterior fallida"))!;
    expect(entry[1]).toEqual({ id: cliente, check: "cascade", motivo: "lectura", rollback: undoFails ? "fallido" : "ok" });
    if (!undoFails) expectNothingChanged(ids, cliente);
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
    const sinSigla = seedCliente("Viejo", null, "Activo");
    expect(await createMaestro("proyectos", { nombreCorto: "X", cliente: [sinSigla], estado: "Activo" })).toMatchObject({
      status: 400,
      fieldErrors: { cliente: PROYECTO_MESSAGES.clienteSinSigla },
    });
  });

  it("solo clientes con Estado Cliente", async () => {
    const lead = seedCliente("Prospecto", "PR", "Inactivo");
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
    const ex = seedCliente("Viejo", "VJ", "Inactivo");
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

describe("Clientes · compatibilidad con el Estado legacy (F2-01 v2, fix 3)", () => {
  it("la lista muestra el legacy «Cliente» como Activo; Lead / Ex cliente / Perdido quedan como están", async () => {
    const legacy = seedCliente("Legacy", "LG", LEGACY_CLIENTE_ACTIVO);
    const otros = LEGACY_CLIENTE_ESTADOS.slice(1).map((estado, i) => [seedCliente(`Otro ${i}`, `O${"ABC"[i]}`, estado), estado] as const);
    const data = await loadMaestro("clientes");
    expect(data.records.find((r) => r.id === legacy)!.values.estado).toBe("Activo");
    for (const [id, estado] of otros) expect(data.records.find((r) => r.id === id)!.values.estado).toBe(estado);
    expect(JSON.stringify(data)).not.toContain(`"${LEGACY_CLIENTE_ACTIVO}"`);
  });

  it("editar un legacy (el formulario manda Activo) guarda «Activo»; si la escritura se revierte, vuelve a «Cliente»", async () => {
    const legacy = seedCliente("Legacy", "LG", LEGACY_CLIENTE_ACTIVO);
    expect(await updateMaestro("clientes", legacy, { nombre: "Legacy", estado: "Activo", sigla: "LG", contacto: "Nuevo" })).toMatchObject({ ok: true });
    expect(fieldsOf(C.id, legacy)[C.fields.estado]).toBe("Activo");

    const otro = seedCliente("Otro", "OT", LEGACY_CLIENTE_ACTIVO);
    seedCliente("Rival", "RV");
    fake.hide(C.id, (r) => r.fields[C.fields.nombre] === "Rival" && fake.calls.filter((c) => c.method === "update").length === 0);
    const res = await updateMaestro("clientes", otro, { nombre: "Rival", estado: "Activo", sigla: "OT" });
    expect(res).toMatchObject({ status: 409 });
    expect(fieldsOf(C.id, otro)[C.fields.estado]).toBe(LEGACY_CLIENTE_ACTIVO);
  });

  it("un alta nunca escribe el valor legacy", async () => {
    expect(await createMaestro("clientes", { nombre: "X", estado: LEGACY_CLIENTE_ACTIVO, sigla: "XX" })).toMatchObject({ status: 400 });
    const ok = (await createMaestro("clientes", { nombre: "X", estado: "Inactivo", sigla: "XX" })) as { ok: true; data: { id: string } };
    expect(fieldsOf(C.id, ok.data.id)[C.fields.estado]).toBe("Inactivo");
  });
});

describe("Clientes · borrado (F2-01)", () => {
  const CF = C.fields;

  it("con referencias → 409 con lo que lo referencia y cuántos, y sugiere Inactivo; no borra", async () => {
    const c = seedCliente("A", "AA", "Activo", {
      [CF.proyectos]: ["recPPPPPPPPPPPPP1", "recPPPPPPPPPPPPP2"],
      [CF.tesoreria]: ["recTTTTTTTTTTTTT1", "recTTTTTTTTTTTTT2", "recTTTTTTTTTTTTT3"],
    });
    const res = await deleteMaestro("clientes", c);
    expect(res).toEqual({ ok: false, status: 409, error: "No se puede borrar: tiene 2 proyectos y 3 movimientos de Tesorería. Pasalo a Inactivo." });
    expect(fake.rows(C.id).some((r) => r.id === c)).toBe(true);
    expect(fake.calls.some((x) => x.method === "delete")).toBe(false);
  });

  it("singular, las tres referencias y el orden de la lista", () => {
    expect(
      CLIENTE_MESSAGES.referenciado([
        { fieldId: CF.proyectos, count: 1 },
        { fieldId: CF.ventas, count: 1 },
        { fieldId: CF.tesoreria, count: 1 },
      ]),
    ).toBe("No se puede borrar: tiene 1 proyecto, 1 venta y 1 movimiento de Tesorería. Pasalo a Inactivo.");
    expect(CLIENTE_MESSAGES.referenciado([{ fieldId: CF.ventas, count: 4 }])).toBe("No se puede borrar: tiene 4 ventas. Pasalo a Inactivo.");
  });

  it("revisa los tres links inversos: Proyectos, Ventas y Tesorería", async () => {
    expect(MAESTRO_CONFIGS.clientes.references).toEqual([CF.proyectos, CF.ventas, CF.tesoreria]);
    for (const fieldId of [CF.proyectos, CF.ventas, CF.tesoreria]) {
      const c = seedCliente(`R ${fieldId}`, null, "Inactivo", { [fieldId]: ["recRRRRRRRRRRRRRR"] });
      expect(await deleteMaestro("clientes", c)).toMatchObject({ status: 409, error: expect.stringContaining("Pasalo a Inactivo.") });
    }
  });

  it("sin referencias → se borra (Activo o Inactivo)", async () => {
    for (const estado of ["Activo", "Inactivo"]) {
      const c = seedCliente(`Libre ${estado}`, "LB", estado);
      expect(await deleteCheckMaestro("clientes", c)).toEqual({
        ok: true,
        data: { blocked: false, message: null, counts: { proyectos: 0, ventas: 0, tesoreria: 0 } },
      });
      expect(await deleteMaestro("clientes", c)).toEqual({ ok: true, data: { id: c } });
      expect(fake.rows(C.id).some((r) => r.id === c)).toBe(false);
    }
  });

  it("el chequeo previo da el mismo mensaje que el 409, sin borrar", async () => {
    const c = seedCliente("A", "AA", "Activo", { [CF.ventas]: ["recVVVVVVVVVVVVVV"] });
    expect(await deleteCheckMaestro("clientes", c)).toEqual({
      ok: true,
      data: { blocked: true, message: "No se puede borrar: tiene 1 venta. Pasalo a Inactivo.", counts: { proyectos: 0, ventas: 1, tesoreria: 0 } },
    });
    expect(fake.calls.some((x) => x.method === "delete")).toBe(false);
  });

  it("relee las referencias justo antes de borrar: si aparece una después del chequeo previo → 409", async () => {
    const c = seedCliente("A", "AA");
    expect(await deleteCheckMaestro("clientes", c)).toMatchObject({ data: { blocked: false } });
    fieldsOf(C.id, c)[CF.proyectos] = ["recPPPPPPPPPPPPPP"]; // otro request le asignó un proyecto
    expect(await deleteMaestro("clientes", c)).toMatchObject({ status: 409, error: expect.stringContaining("1 proyecto") });
    expect(fake.rows(C.id).some((r) => r.id === c)).toBe(true);
  });

  it("un maestro sin borrado da 405 también en el chequeo previo", async () => {
    expect(await deleteCheckMaestro("parametros", "recAAAAAAAAAAAAAA")).toMatchObject({ status: 405 });
    expect(await deleteCheckMaestro("clientes", "no-es-id")).toMatchObject({ status: 404 });
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

  it("Proyectos y Parámetros no se borran (Clientes sí, desde F2-01)", async () => {
    expect(await deleteMaestro("parametros", "recAAAAAAAAAAAAAA")).toMatchObject({ status: 405 });
    expect(await deleteMaestro("proyectos", "recAAAAAAAAAAAAAA")).toMatchObject({ status: 405 });
  });

  it("inexistente → 404", async () => {
    expect(await deleteMaestro("clientes", "recNOEXISTE000000")).toMatchObject({ status: 404 });
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

describe("Payload inválido = bug del servidor (NEW-03)", () => {
  const config = MAESTRO_CONFIGS["unidades-de-negocio"];
  const original = config.beforeWrite;
  afterEach(() => {
    config.beforeWrite = original;
  });

  it("campo de solo lectura en el payload → 500 genérico, nada escrito, log solo con tabla e IDs de campo", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    config.beforeWrite = async () => ({ extraFields: { [UN.fields.proyectos]: ["recPPPPPPPPPPPPPP"] } });
    expect(await createMaestro("unidades-de-negocio", { nombre: "Secreta" })).toEqual({ ok: false, status: 500, error: "Ocurrió un error. Probá de nuevo." });
    expect(fake.calls.some((c) => c.method !== "list")).toBe(false);
    const entry = errorLog.mock.calls.find((c) => String(c[0]).includes("Payload inválido"))!;
    expect(entry[1]).toEqual({ problems: [{ table: UN.id, fields: [UN.fields.proyectos] }] });
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(/Secreta|recPPPP/);
  });

  it("update relacionado con un ID de registro inválido o un campo de otra tabla → 500, nada escrito", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    config.beforeWrite = async () => ({ related: [{ table: "proyectos", id: "no-es-id", fields: { [C.fields.sigla]: "X" }, previous: { [C.fields.sigla]: null } }] });
    expect(await createMaestro("unidades-de-negocio", { nombre: "X" })).toMatchObject({ status: 500, error: "Ocurrió un error. Probá de nuevo." });
    expect(fake.calls.some((c) => c.method !== "list")).toBe(false);
  });
});
