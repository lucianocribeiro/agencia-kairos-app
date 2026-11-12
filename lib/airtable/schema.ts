import "server-only";

/**
 * Fuente única de verdad de IDs de Airtable.
 *
 * Base: appxGhn6qLbmWvMke. El ID de la base se lee siempre de la variable de
 * entorno AIRTABLE_BASE_ID (ver lib/env.ts); acá queda solo como referencia.
 *
 * Reglas:
 * - Siempre se usan IDs de tabla y de campo, nunca nombres.
 * - Lecturas con `returnFieldsByFieldId=true`; escrituras por ID de campo.
 * - `name` es solo documentación: no se usa para hablar con la API.
 */

export const TABLES = {
  parametros: {
    id: "tblWE27A6zUHZ9J0m",
    name: "Parámetros",
    fields: {
      concepto: "fldy0HInUu6A3sM5l",
      valor: "fld1ssjTyPU1S335e",
      descripcion: "fldP7mTmahfGZZHLE",
    },
  },

  usuarios: {
    id: "tblzdplcR97Ltj6vi",
    name: "Usuarios",
    fields: {
      nombre: "fldB9W48Cav5XRObU",
      email: "fld6Opt1EZhun7vKN",
      /** singleSelect: ver `choices.rol` */
      rol: "fld3aCCODi0smvQQG",
      /** singleSelect: ver `choices.estado` */
      estado: "fldrlPu1qQZVtTjKw",
      sigla: "fldPQ8WcmyMJqJOXl",
      /** Nunca se devuelve a nadie. */
      passwordHash: "fldbKH5lVR1bEpfqV",
      /** checkbox */
      debeCambiarPassword: "fldTuOm2vDwBhiGBB",
      /** dateTime, tz America/Argentina/Buenos_Aires */
      ultimoAcceso: "fldtFbRLT9bP0cula",
      /** link → Socios */
      socio: "fldJXvRBnv4cwWe4B",
      /** link → Proyectos */
      proyectosAsignados: "fldA6Oox4hltXgIdr",
      /** Link inverso "Horas" (Horas.colaborador). Solo lectura: nunca se escribe. */
      horasReverse: "fld1nrDsbGZcps9My",
      /** Link inverso "Horas 2" (Horas.cargadoPor). Solo lectura: nunca se escribe. */
      horas2Reverse: "fldF1Kkuo2a3Y3mtp",
    },
    choices: {
      rol: ["Admin", "Empleado"],
      estado: ["Activo", "Inactivo"],
    },
  },

  socios: {
    id: "tblycySINMIvUjvs3",
    name: "Socios",
    fields: {
      sigla: "fldZJlMAzE5iEKM8H",
      nombre: "fldw5I8dKZqnBNYBN",
      /** percent: la API devuelve un decimal (0.5 = 50 %) */
      porcentajeRetiros: "fldF1vdh3Fnc9ikfd",
    },
  },

  unidadesNegocio: {
    id: "tbltfxKFotqMD7xDq",
    name: "Unidades de negocio",
    fields: {
      nombre: "fldfvpNzag1AioI1v",
    },
  },

  categorias: {
    id: "tblfYPKA1jHzQZLSP",
    name: "Categorías",
    fields: {
      nombre: "fldrrQBjmbYNbd2TG",
      /** singleSelect: ver `choices.tipo` */
      tipo: "fldNyFuZJLvR0RZeD",
      requiereProyecto: "fldtPBOw0KCG3Z9mI",
    },
    choices: {
      tipo: ["Ingreso", "Gasto"],
    },
  },

  cuentas: {
    id: "tbla1ygaoXgfJA7j2",
    name: "Cuentas",
    fields: {
      nombre: "fldUGepFxAq2zlB3s",
      /** singleSelect: ver `choices.moneda` */
      moneda: "fldj38B1Ne4xB44Bv",
      banco: "fld3vS2NtrqtsJftI",
      cbu: "fld2oEUBfMUTe0BWE",
      saldoInicial: "fldpJvKGcj1KnlY67",
      fechaSaldoInicial: "fld2IlAnqu22wDyjp",
    },
    choices: {
      moneda: ["ARS", "USD"],
    },
  },

  tiposComprobante: {
    id: "tblVedAvNV3s7XoT9",
    name: "Tipos de comprobante",
    fields: {
      codigo: "fldvcpVg1SQHxQPnc",
      descripcion: "fld9ckJyxqUv1zun2",
      signo: "fld8Ihuj2aDa7CdDu",
    },
  },

  clientes: {
    id: "tblsf0Wa09QVk3vvR",
    name: "Clientes",
    fields: {
      nombre: "fldlLmQ2W5WaHRep7",
      sigla: "fldJy8yFjznzVa0jM",
      /** singleSelect: ver `choices.estado` */
      estado: "fldlwurARTXHY6h34",
      cuit: "fldRVRZbVfkqhzBL9",
      /** singleSelect: ver `choices.condicionIva` */
      condicionIva: "fldFYNOAP6B5y0ig5",
      contacto: "fldZk2JMY3D20EXfb",
      telefono: "fldWiDGoAIapY06kH",
      mail: "fldhp5lVafjdAsdFB",
      observaciones: "fldzUhgXEDxvv89aY",
    },
    choices: {
      estado: ["Cliente", "Lead", "Ex cliente", "Perdido"],
      condicionIva: [
        "Responsable Inscripto",
        "Monotributista",
        "Exento",
        "Consumidor Final",
        "Cliente del Exterior",
      ],
    },
  },

  tiposOperacion: {
    id: "tblzYxYE2AGEwiLQS",
    name: "Tipos de operación",
    fields: {
      nombre: "fldg6kM5c0ybOX25y",
      /** singleSelect: ver `choices.movimiento` */
      movimiento: "fldIecrTCnrw53JdH",
      sumaAResultados: "fld2iVGq9Vq36VdZT",
      /** link → Categorías */
      categoriaPorDefecto: "fld0mDUthxRN7JyjI",
      pideClienteProveedor: "fldLXNYk1keAGueCV",
      esDeSocio: "fldq509hY3qgc3VpH",
    },
    choices: {
      movimiento: ["Cobranza", "Pago", "Ambos"],
    },
  },

  proyectos: {
    id: "tblzEUTnTydUUGHnx",
    name: "Proyectos",
    fields: {
      codigo: "fldmEes9LznGb5Dsw",
      nombreCorto: "fldn8SZM7IHWEfkVv",
      /** link → Clientes */
      cliente: "fldOdWCFWFotX4Xm2",
      /** link → Unidades de negocio */
      unidadNegocio: "fldIsN2ja2e11PXtS",
      /** singleSelect: ver `choices.monedaValorHora` */
      monedaValorHora: "fldKih9lOF7HqwG8C",
      valorHora: "fldBCn8fontl0WJKL",
      /** singleSelect: ver `choices.estado` */
      estado: "fldOYbUskhrqwkVCn",
      descripcion: "fldwIsCSOB486kRue",
      /** Link inverso de Usuarios.proyectosAsignados. Solo lectura. */
      usuarios: "fldX6jchng6G6l1ni",
    },
    choices: {
      monedaValorHora: ["ARS", "USD"],
      estado: ["Activo", "Cerrado"],
    },
  },

  proveedores: {
    id: "tblSCTjxBljFohYij",
    name: "Proveedores",
    fields: {
      nombre: "fld4dukOxE3bYNhui",
      cuit: "fldfEmnv5tohJncdz",
      /** singleSelect: ver `choices.condicionIva` */
      condicionIva: "fld05WsM1PQgeynLR",
      contacto: "fld6gK18VqstLE5VU",
      telefono: "fldhNJNguRneWPKdM",
      mail: "fldNgiOzDLaiOEJi1",
      /** link → Categorías */
      categoriaPorDefecto: "fldOT6WXx9NiywG4K",
      observaciones: "fldop7yLAdmlChdl5",
    },
    choices: {
      condicionIva: [
        "Responsable Inscripto",
        "Monotributista",
        "Exento",
        "Consumidor Final",
        "Proveedor del Exterior",
      ],
    },
  },

  horas: {
    id: "tblpeUSIYD7BFlGQU",
    name: "Horas",
    fields: {
      /** autoNumber */
      numero: "fld71Jp88DZeeCWIB",
      /** date (AAAA-MM-DD) */
      fecha: "fldLi8iQs4y3CEIAg",
      /** link → Usuarios */
      colaborador: "fldopofFaNcWPQJQ5",
      /** link → Proyectos */
      proyecto: "fldCSwGlmGvGGCu6r",
      tarea: "fld5crg5KKnsYcpUE",
      /** duration: segundos enteros desde las 00:00 */
      horaDesde: "fldEfi5mdhe9mECYy",
      /** duration: segundos enteros desde las 00:00 */
      horaHasta: "fldx8auE74Glu8CJl",
      facturable: "fldXXGI9Udo683Uef",
      /** date */
      mesAFacturar: "fldPEfmYeYcbQeVhD",
      /** formula */
      horas: "fldTSWNksJnEbYTLW",
      /** rollup */
      valorHora: "fldwFQXJUDKuqgk1G",
      /** rollup */
      moneda: "fld602JbfkZ5JTc2o",
      /** lookup */
      cliente: "fldZENPxhthEKLFwI",
      /** formula */
      importeAFacturar: "fldiP68Xn1FBguBef",
      /** formula */
      mesTrabajado: "fldGHAQu50u2bplH6",
      /** formula */
      mesAFacturarAAAAMM: "fldZnamaVXZbFf2YX",
      /** createdTime */
      creado: "fldJBZYpRBvDMWhdO",
      /** link → Usuarios */
      cargadoPor: "fldM3DuGsdg5ziNFU",
    },
  },
} as const;

type Tables = typeof TABLES;
export type TableKey = keyof Tables;
export type TableId = Tables[TableKey]["id"];
export type FieldId = {
  [K in TableKey]: Tables[K]["fields"][keyof Tables[K]["fields"]];
}[TableKey];

const F = {
  usuarios: TABLES.usuarios.fields,
  proyectos: TABLES.proyectos.fields,
  horas: TABLES.horas.fields,
};

/** Campos formula, rollup, lookup, createdTime y autoNumber. Nunca se envían en escrituras. */
export const COMPUTED_FIELDS: ReadonlySet<string> = new Set<FieldId>([
  F.horas.numero,
  F.horas.horas,
  F.horas.valorHora,
  F.horas.moneda,
  F.horas.cliente,
  F.horas.importeAFacturar,
  F.horas.mesTrabajado,
  F.horas.mesAFacturarAAAAMM,
  F.horas.creado,
]);

/** Links inversos que se leen pero nunca se escriben desde la app. */
export const READ_ONLY_FIELDS: ReadonlySet<string> = new Set<FieldId>([
  F.usuarios.horasReverse,
  F.usuarios.horas2Reverse,
  F.proyectos.usuarios,
]);

/** Campos que nunca se devuelven a nadie (ni Admin ni Empleado). */
export const SECRET_FIELDS: ReadonlySet<string> = new Set<FieldId>([F.usuarios.passwordHash]);

/**
 * Campos que nunca se devuelven a un Empleado. Incluye SECRET_FIELDS, que
 * tampoco se devuelven a un Admin.
 */
export const RESTRICTED_FIELDS: ReadonlySet<string> = new Set<FieldId>([
  ...(SECRET_FIELDS as ReadonlySet<FieldId>),
  F.horas.valorHora,
  F.horas.moneda,
  F.horas.importeAFacturar,
  F.horas.cliente,
  F.proyectos.valorHora,
  F.proyectos.monedaValorHora,
]);

/** fieldId → tableId, para validar que un campo pertenece a la tabla que se escribe. */
export const FIELD_TABLE: ReadonlyMap<string, TableId> = new Map(
  Object.values(TABLES).flatMap((table) =>
    Object.values(table.fields).map((fieldId) => [fieldId, table.id] as const),
  ),
);

export const TABLE_IDS: ReadonlySet<string> = new Set(Object.values(TABLES).map((t) => t.id));
