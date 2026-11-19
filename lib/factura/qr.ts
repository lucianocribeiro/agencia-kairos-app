import "server-only";

import { correction, generate } from "lean-qr";

import { CBTE_TIPO_FACTURA_A, DOC_TIPO_CUIT, type FacturaDatos } from "./factura";

/**
 * QR de la factura según la especificación de ARCA (RG 4892): la URL
 * https://www.arca.gob.ar/fe/qr/?p=<base64 del JSON v1>, con
 * {ver: 1, fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda: "PES", ctz: 1,
 *  tipoDocRec: 80, nroDocRec, tipoCodAut: "E", codAut}. Números como números.
 */
export const QR_BASE_URL = "https://www.arca.gob.ar/fe/qr/?p=";

export interface QrPayload {
  ver: 1;
  fecha: string;
  cuit: number;
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  importe: number;
  moneda: "PES";
  ctz: 1;
  tipoDocRec: number;
  nroDocRec: number;
  tipoCodAut: "E";
  codAut: number;
}

export function qrPayload(d: FacturaDatos & { numero: number; cae: string }): QrPayload {
  return {
    ver: 1,
    fecha: d.fechaEmision,
    cuit: Number(d.emisor.cuit),
    ptoVta: d.puntoVenta,
    tipoCmp: CBTE_TIPO_FACTURA_A,
    nroCmp: d.numero,
    importe: d.importes.total / 100,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: DOC_TIPO_CUIT,
    nroDocRec: Number(d.receptor.cuit),
    tipoCodAut: "E",
    codAut: Number(d.cae),
  };
}

export const qrUrl = (p: QrPayload): string => `${QR_BASE_URL}${Buffer.from(JSON.stringify(p), "utf8").toString("base64")}`;

/** Matriz del QR (true = módulo oscuro), nivel de corrección M. */
export function qrMatrix(text: string): boolean[][] {
  const code = generate(text, { minCorrectionLevel: correction.M });
  return Array.from({ length: code.size }, (_, y) => Array.from({ length: code.size }, (_, x) => code.get(x, y)));
}
