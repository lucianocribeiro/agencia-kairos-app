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
      rol: ["Admin", "Empleado", "Cliente"],
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
      /** Link inverso (solo lectura): Usuarios.socio. */
      usuarios: "fldCtk8E0nQ9uzjNX",
      /** Link inverso (solo lectura): Compras.imputar a socio. */
      compras: "fldw8DkZohIFwAgYz",
      /** Link inverso (solo lectura): Tesorería.socio. */
      tesoreria: "fldSHwsvCIPzZ34ud",
    },
  },

  unidadesNegocio: {
    id: "tbltfxKFotqMD7xDq",
    name: "Unidades de negocio",
    fields: {
      nombre: "fldfvpNzag1AioI1v",
      /** Link inverso (solo lectura): Proyectos.unidadNegocio. */
      proyectos: "fldgCDhb3F01NCz4l",
      /** Link inverso (solo lectura): Ventas.unidad de negocio. */
      ventas: "fld4csMflNzYGAg7B",
      /** Link inverso (solo lectura): Compras.unidad de negocio. */
      compras: "fldaxfL91AtohiLrU",
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
      /** Link inverso (solo lectura): Tipos de operación.categoriaPorDefecto. */
      tiposOperacion: "fldQiaXj3UFOTDafD",
      /** Link inverso (solo lectura): Ventas.categoría. */
      ventas: "fldjjumvQVqxV3s9d",
      /** Link inverso (solo lectura): Compras.categoría. */
      compras: "fldcuTHJLAiGOB1TT",
      /** Link inverso (solo lectura): Tesorería.categoría. */
      tesoreria: "fld14ttxfT8RWfUYY",
      /** Link inverso (solo lectura): Proveedores.categoriaPorDefecto. */
      proveedores: "fldq0YnGo38FlM29R",
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
      /** Link inverso (solo lectura): Tesorería.cuenta. */
      tesoreria: "fldJemNAUfadsTYdf",
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
      /** Link inverso (solo lectura): Ventas.tipo comprobante. */
      ventas: "fldxRBIM7G1WK0mII",
      /** Link inverso (solo lectura): Compras.tipo comprobante. */
      compras: "fldFz7UCDUUTmu9lO",
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
      /** Link inverso (solo lectura): Proyectos.cliente. */
      proyectos: "fldEu1ghFqF8jtVMM",
      /** Link inverso (solo lectura): Ventas.cliente. */
      ventas: "fldP7WVJnruka9dt5",
      /** Link inverso (solo lectura): Tesorería.cliente. */
      tesoreria: "fldfq5DMOJLuKAXop",
      /**
       * Link inverso "Leads" (Leads.cliente, CC-F4-06). Solo lectura: el ABM de Clientes no
       * lo lee, no lo muestra ni lo escribe, y no bloquea el borrado (no está en REFERENCE_FIELDS).
       */
      leads: "fldVOksrSGDYTcIaw",
    },
    choices: {
      estado: ["Activo", "Inactivo"],
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
      /** Link inverso (solo lectura): Tesorería.tipo de operación. */
      tesoreria: "fldeQasfm66TayGIJ",
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
      /** Link inverso (solo lectura): Ventas.proyecto. */
      ventas: "fldDhArTXATCLna3Q",
      /** Link inverso (solo lectura): Compras.proyecto. */
      compras: "fldcyBqMayWdN3TXv",
      /** Link inverso (solo lectura): Horas.proyecto. */
      horas: "fldAuFs9t1ZXiScGp",
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
      /** Link inverso (solo lectura): Compras.proveedor. */
      compras: "fldoVdDyGjRq8kakf",
      /** Link inverso (solo lectura): Tesorería.proveedor. */
      tesoreria: "fldqI92QpqZ9FJXCx",
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

  /**
   * Ventas: base ARCA «Mis Comprobantes Emitidos». Las columnas ARCA se guardan tal
   * cual (importes en la moneda del comprobante); los importes en pesos los calcula
   * solo la app (lib/ventas-compras).
   */
  ventas: {
    id: "tbl1N4iLAHBLwycxx",
    name: "Ventas",
    fields: {
      /** primario; Código|Punto de venta|Número desde|Doc. receptor (lo arma la app) */
      claveArca: "fld3k1AovUYvNzhxD",
      fecha: "fldvUp2yuuyGrHxBc",
      /** texto tal cual ARCA (p. ej. "11 - Factura C") */
      tipo: "fldVdoj1A1JhT1x28",
      /** link → Tipos de comprobante */
      tipoComprobante: "fldejKodGxi8XKTIO",
      puntoVenta: "fldmJOhFtxpWnNaJy",
      numeroDesde: "fldrZn9gyTaYdwIKl",
      numeroHasta: "fldanzWK2Q9fts1JY",
      codAutorizacion: "fld8Sd22J9cGYyOt1",
      tipoDocReceptor: "fldDCG88cBMmETEOq",
      nroDocReceptor: "fldvaHVYaFz1onwyc",
      denominacionReceptor: "fldfe2yZx9y5oJ2uS",
      tipoCambio: "fldDBpbQcgnwsGTpu",
      moneda: "flddhFebZnTRjUK7s",
      netoGravIva0: "fldQgk5YMv7LiIOji",
      iva25: "fldu1DIhHKtPKw9uU",
      netoGravIva25: "fldiOhylOH8al3jiq",
      iva5: "fld8YjelGljKqHjHG",
      netoGravIva5: "fldoUfaZ1P2Ea6ljL",
      iva105: "fldODc03g84bQXlfy",
      netoGravIva105: "fld6rOvVr5JliiHQR",
      iva21: "fldeUaAGhHRWB77KE",
      netoGravIva21: "fldGJMO7KnqTuHhJR",
      iva27: "fld6De3upC5kq8MnI",
      netoGravIva27: "flddDMatUea5JCYLh",
      netoGravadoTotal: "fldgdm2Si4SZ1JStJ",
      netoNoGravado: "fld8q1f9W1bqnRgPd",
      opExentas: "fldJyC5OLxSs9cZzH",
      otrosTributos: "fldiedaMi2n9WVs6e",
      totalIva: "fldrJMyTYKr8bWnZS",
      impTotal: "fldc2eEjO9pATwMPi",
      /** date; vacío = mes de Fecha (valor efectivo calculado por la app) */
      mesDevengado: "fldNNsRbkHvR5tq3q",
      /** link → Proyectos */
      proyecto: "fldW248MTOEe9h3Il",
      /** link → Unidades de negocio; vacío = la del proyecto */
      unidadNegocio: "fld1Y6FyovvBvRxKu",
      /** link → Categorías; vacío = Parámetro «Categoría por defecto en Ventas» */
      categoria: "fldnhEupCnutCMdpR",
      /** link → Clientes; del proyecto o por CUIT (lo setea la app) */
      cliente: "fldqeqrBsP8fG7erx",
      observaciones: "fld0RYRhVnGh7Ss9l",
    },
  },

  /** Compras: base ARCA «Mis Comprobantes Recibidos». Si se imputa a socio, no resta en resultados. */
  compras: {
    id: "tblXQTrJEaptAPR0i",
    name: "Compras",
    fields: {
      /** primario; Código|Punto de venta|Número desde|Doc. emisor (lo arma la app) */
      claveArca: "fldC6kp7s2tcmfRkk",
      fecha: "fldCLLr2HV7EP5rKN",
      tipo: "flddluHHhuEqqB7JB",
      /** link → Tipos de comprobante */
      tipoComprobante: "fldDLiz1w3t5F3ftX",
      puntoVenta: "fldCRal8mJr1zHuJI",
      numeroDesde: "fldiqxKBru0PqNZiy",
      numeroHasta: "fldEZTIfNh6eWfOJn",
      codAutorizacion: "fld8euUldC2q0ljai",
      tipoDocEmisor: "fld7vxIXRi9iL2lTB",
      nroDocEmisor: "fldIjukZxAJipjuW2",
      denominacionEmisor: "fldYzaGcRmMcWXgRD",
      tipoDocReceptor: "fldQuSNMpwSt5KVQv",
      nroDocReceptor: "fldR9hAHx75UkFR4d",
      tipoCambio: "fldPAD8KL6D4zilcN",
      moneda: "fldTWxVIE9nQc1gng",
      netoGravIva0: "fldoGGDea1Zm7Nexw",
      iva25: "fldJdAy1oKePtNTCn",
      netoGravIva25: "fldb7YdGm7ALhcMtF",
      iva5: "fldgRDiexSHVce2EE",
      netoGravIva5: "fldB3S8opDHxHkf8B",
      iva105: "fld5ojx45b3f7LE6J",
      netoGravIva105: "fldyiGgtKnVE2S7qa",
      iva21: "fldIGiscOwbO5flBR",
      netoGravIva21: "fldpNLuQ0s5iYbqP8",
      iva27: "fld9oDaOoJNq4NyYq",
      netoGravIva27: "fldxo0SmXuDQLItsR",
      netoGravadoTotal: "flddHkxt2m9xiEgmm",
      netoNoGravado: "fldpgjE82ZCi4Quau",
      opExentas: "fldPJIGBDOfOHqkt1",
      otrosTributos: "fldWjJPFNi4nYZMyt",
      totalIva: "fldKE5bTpS9TZIEXH",
      impTotal: "fldrpPdqNFtRbmZFQ",
      mesDevengado: "fld32byPKTSmGoEjN",
      /** link → Proyectos */
      proyecto: "fld5Qvvh6I8DIjC5f",
      /** link → Unidades de negocio; vacío = la del proyecto */
      unidadNegocio: "fldv3rWNSWyuj711h",
      /** link → Categorías; al importar, la Categoría por defecto del proveedor */
      categoria: "fldIa5yWN9KPgR6Oy",
      /** link → Socios; gasto particular: no resta en resultados */
      socio: "fldzaosyE1rhorV2Q",
      observaciones: "fldgUTLTZwcWuLWpw",
      /** link → Proveedores; por CUIT (Nro. Doc. Emisor), lo setea la app */
      proveedor: "fldc2aAKhaT2ipH72",
    },
  },

  /**
   * Tesorería: un registro por movimiento. Importe siempre positivo en la moneda de
   * la cuenta; Movimiento dice si entra o sale. Transferencia propia = 2 registros
   * con el mismo `transferencia`. Los importes en pesos los calcula la app
   * (lib/tesoreria).
   */
  tesoreria: {
    id: "tblsY1CLYlxflED9i",
    name: "Tesorería",
    fields: {
      /** autoNumber (solo lectura) */
      numero: "fldGe8qHxAgDgYXrF",
      fecha: "fldc7jXYNIgnqksoZ",
      /** link → Cuentas */
      cuenta: "fld8ZSqPwVKATiqxo",
      /** singleSelect: ver `choices.movimiento` */
      movimiento: "fldn2UYmCYLK2XQkN",
      /** positivo, en moneda de la cuenta */
      importe: "fldXjxzE9xg5qUOYt",
      /** link → Tipos de operación */
      tipoOperacion: "fldHtCpTpvokA9cfS",
      /** link → Clientes (cobranzas) */
      cliente: "fldSYDruIvvhN88R8",
      /** link → Proveedores (pagos) */
      proveedor: "fldwOJRMYaQp5At5N",
      /** singleSelect S|N; vacío = según el tipo de operación */
      sumaResultados: "fldLINpRMzwIZrPQU",
      /** link → Categorías; vacío = la del tipo de operación */
      categoria: "fldCtxdyd5br1XqWt",
      /** link → Socios */
      socio: "fldHrsLSVn1vzdmun",
      /** solo cuentas en USD; hasta 4 decimales */
      tipoCambio: "fldeI59QpM9rx0ucU",
      descripcion: "fldiiy3Ff9kkrpnFb",
      /** ID compartido por los 2 registros de una transferencia propia (lo escribe la app) */
      transferencia: "fldx7UFCK79B1XzIr",
    },
    choices: {
      movimiento: ["Cobranza", "Pago"],
      sumaResultados: ["S", "N"],
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
      /** createdTime */
      creado: "fldJBZYpRBvDMWhdO",
      /** link → Usuarios */
      cargadoPor: "fldM3DuGsdg5ziNFU",
    },
  },

  /**
   * Leads (CC-F4-06, solo Admin): misma estructura que el CRM de Kairos. Un lead pasa a
   * Clientes con «Pasar a cliente» (lib/leads/server/service.ts): queda Tipo = Cliente y
   * Cliente = el cliente creado, y desde ahí solo se puede borrar.
   */
  leads: {
    id: "tblZfsKxIckVSNRlV",
    name: "Leads",
    fields: {
      /** primario */
      nombre: "fldq8J1WaUiMl8fqI",
      /** singleSelect: ver `choices.tipo` («Cliente» solo lo escribe la conversión) */
      tipo: "fld7viUkRfGwaX33E",
      /** singleSelect: ver `choices.status` */
      status: "fld5p3RK5G0JJxmqQ",
      /** multilineText */
      proyecto: "fldFQ1KhgW7hsA3jn",
      contacto: "fldMLW6VEoRzUU6wV",
      /** phoneNumber */
      telefono: "fldlYSdtbQtmK1HSh",
      /** email */
      mail: "fldTbo0itAwTsTtg4",
      /** singleSelect: ver `choices.origen` */
      origen: "fldlyIddv6yB5T30F",
      referidoPor: "fldeX0DEHzLbqvRZ3",
      /** multilineText */
      comentarios: "fldfA6NoqDF0xFVnc",
      ventas: "fldjpJHz4Tr8mKfkw",
      cobranzas: "fldHdujd5mywXj8Ys",
      ventasSrl: "flddA1ngmH2SjYLEa",
      cobranzasSrl: "fld1T55CjnHNX8AAd",
      /** link → Clientes: el cliente creado por la conversión. Solo lo escribe la conversión. */
      cliente: "fldqfK9S27C6ZsqXa",
    },
    choices: {
      tipo: ["Cliente", "Lead", "Ex Cliente", "Frío", "Partnership"],
      status: ["Activo", "Concluido"],
      origen: ["F&F", "Referidos", "Orgánico"],
    },
  },

  /**
   * Registro de intentos de login para bloqueo temporal. Lo escribe sólo el servidor.
   * Nunca se guardan contraseñas ni hashes acá. Creada con scripts/setup-intentos-login.mjs.
   */
  intentosLogin: {
    id: "tblTog0yzQMn9oQyb",
    name: "Intentos de login",
    fields: {
      /** primario; email normalizado (trim + minúsculas) */
      email: "fldpiSBeXKuyf0tFK",
      ip: "fld88TsM7298108GB",
      /** singleSelect: ver `choices.resultado` */
      resultado: "fldJN0vlohIeJH3Ie",
      /** dateTime ISO 24 h, tz America/Argentina/Buenos_Aires; la setea el servidor */
      fecha: "fld1AfVFZryzFDMUF",
    },
    choices: {
      resultado: ["Fallido", "Exitoso", "Bloqueado"],
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
  tesoreria: TABLES.tesoreria.fields,
  usuarios: TABLES.usuarios.fields,
  proyectos: TABLES.proyectos.fields,
  horas: TABLES.horas.fields,
};

/**
 * Campos que llena Airtable solo (autoNumber y createdTime): Airtable rechaza
 * cualquier escritura. Nunca se envían en escrituras (guard en payload.ts).
 * En la base no hay campos fórmula, rollup, lookup ni count: todo cálculo vive en
 * la app (AGENTS.md). Si se agrega un campo que llena Airtable, va acá.
 */
export const COMPUTED_FIELDS: ReadonlySet<string> = new Set<FieldId>([
  F.horas.numero,
  F.horas.creado,
  F.tesoreria.numero,
]);

/**
 * Links inversos: "quién apunta a este registro". Se leen (chequeo de
 * referencias antes de borrar, listas) pero nunca se escriben desde esta tabla.
 * Es también la lista de referencias que bloquean un borrado.
 */
export const REFERENCE_FIELDS = {
  usuarios: [F.usuarios.horasReverse, F.usuarios.horas2Reverse],
  socios: [TABLES.socios.fields.usuarios, TABLES.socios.fields.compras, TABLES.socios.fields.tesoreria],
  unidadesNegocio: [
    TABLES.unidadesNegocio.fields.proyectos,
    TABLES.unidadesNegocio.fields.ventas,
    TABLES.unidadesNegocio.fields.compras,
  ],
  categorias: [
    TABLES.categorias.fields.tiposOperacion,
    TABLES.categorias.fields.ventas,
    TABLES.categorias.fields.compras,
    TABLES.categorias.fields.tesoreria,
    TABLES.categorias.fields.proveedores,
  ],
  cuentas: [TABLES.cuentas.fields.tesoreria],
  tiposComprobante: [TABLES.tiposComprobante.fields.ventas, TABLES.tiposComprobante.fields.compras],
  clientes: [TABLES.clientes.fields.proyectos, TABLES.clientes.fields.ventas, TABLES.clientes.fields.tesoreria],
  tiposOperacion: [TABLES.tiposOperacion.fields.tesoreria],
  proyectos: [F.proyectos.usuarios, TABLES.proyectos.fields.ventas, TABLES.proyectos.fields.compras, TABLES.proyectos.fields.horas],
  proveedores: [TABLES.proveedores.fields.compras, TABLES.proveedores.fields.tesoreria],
  parametros: [],
  // Ventas y Compras no tienen links inversos (nadie apunta a ellas).
  ventas: [],
  compras: [],
  // Nadie apunta a Tesorería.
  tesoreria: [],
  horas: [],
  intentosLogin: [],
  // Nadie apunta a Leads.
  leads: [],
} as const satisfies Record<TableKey, readonly FieldId[]>;

/**
 * Links inversos que no bloquean el borrado (no están en REFERENCE_FIELDS): Clientes › Leads.
 * Un cliente creado desde un lead se sigue borrando como hoy (CC-F4-06).
 */
export const INVERSE_ONLY_FIELDS = [TABLES.clientes.fields.leads] as const satisfies readonly FieldId[];

/** Links inversos que se leen pero nunca se escriben desde la app. */
export const READ_ONLY_FIELDS: ReadonlySet<string> = new Set<FieldId>([...Object.values(REFERENCE_FIELDS).flat(), ...INVERSE_ONLY_FIELDS]);

/** Campos que nunca se devuelven a nadie (ni Admin ni Empleado). */
export const SECRET_FIELDS: ReadonlySet<string> = new Set<FieldId>([F.usuarios.passwordHash]);

/**
 * Campos que nunca se devuelven a un Empleado. Incluye SECRET_FIELDS, que
 * tampoco se devuelven a un Admin.
 */
export const RESTRICTED_FIELDS: ReadonlySet<string> = new Set<FieldId>([
  ...(SECRET_FIELDS as ReadonlySet<FieldId>),
  F.proyectos.valorHora,
  F.proyectos.monedaValorHora,
  /** Segunda barrera: el camino del Empleado ya no lo lee (criterio 7 de Fase 1). */
  F.proyectos.cliente,
]);

/** fieldId → tableId, para validar que un campo pertenece a la tabla que se escribe. */
export const FIELD_TABLE: ReadonlyMap<string, TableId> = new Map(
  Object.values(TABLES).flatMap((table) =>
    Object.values(table.fields).map((fieldId) => [fieldId, table.id] as const),
  ),
);

export const TABLE_IDS: ReadonlySet<string> = new Set(Object.values(TABLES).map((t) => t.id));
