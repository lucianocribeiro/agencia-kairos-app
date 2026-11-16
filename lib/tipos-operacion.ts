/**
 * Tipos de operación que la app busca por nombre exacto. Única fuente de estos nombres:
 * Tesorería (transferencias), Reportes (Socios y Saldos) y la protección de Maestros
 * (no se pueden renombrar ni borrar) leen de acá. Client-safe.
 *
 * Renombrar uno exige cambiar esta constante y el registro de Airtable juntos.
 */
export const TIPOS_OPERACION = {
  transferencia: "Transferencia entre cuentas propias",
  retiroSocio: "Retiro de socio",
  gastoSocio: "Gasto particular de socio",
  aporteSocio: "Aporte de socio",
  cobroCliente: "Cobro a cliente",
  pagoProveedor: "Pago a proveedor",
} as const;

export type TipoOperacionProtegido = (typeof TIPOS_OPERACION)[keyof typeof TIPOS_OPERACION];

/** Los 6 nombres protegidos en Maestros › Tipos de operación. */
export const TIPOS_OPERACION_PROTEGIDOS: readonly TipoOperacionProtegido[] = Object.values(TIPOS_OPERACION);
