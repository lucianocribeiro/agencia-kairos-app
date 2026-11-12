import { describe, expect, it } from "vitest";

import { cuitCheckDigit, CUIT_MESSAGES, formatCuit, isValidCuit, normalizeCuit, parseCuit } from "./cuit";

describe("CUIT", () => {
  it("dígito verificador módulo 11", () => {
    // 2·5+0·4+1·3+2·2+3·7+4·6+5·5+6·4+7·3+8·2 = 148; 148 % 11 = 5; 11 − 5 = 6
    expect(cuitCheckDigit("2012345678")).toBe(6);
    expect(cuitCheckDigit("3369345023")).toBe(9); // AFIP
  });

  it("válidos, con o sin guiones/espacios", () => {
    expect(parseCuit("20-12345678-6")).toEqual({ digits: "20123456786" });
    expect(parseCuit("20123456786")).toEqual({ digits: "20123456786" });
    expect(parseCuit(" 33 69345023 9 ")).toEqual({ digits: "33693450239" });
    expect(isValidCuit("30-71234567-1")).toBe(cuitCheckDigit("3071234567") === 1);
  });

  it("dígito verificador incorrecto", () => {
    expect(parseCuit("20-12345678-5")).toEqual({ error: CUIT_MESSAGES.verificador });
    expect(parseCuit("33-69345023-0")).toEqual({ error: CUIT_MESSAGES.verificador });
  });

  it("verificador 10 (no existe) → inválido", () => {
    // buscar un prefijo cuyo verificador sea 10 y comprobar que ningún dígito final lo valida
    let first10 = "";
    for (let n = 2000000000; n < 2000001000; n++) {
      if (cuitCheckDigit(String(n)) === null) {
        first10 = String(n);
        break;
      }
    }
    expect(first10).not.toBe("");
    for (let d = 0; d <= 9; d++) expect(isValidCuit(first10 + d)).toBe(false);
  });

  it("largo distinto de 11", () => {
    expect(parseCuit("2012345678")).toEqual({ error: CUIT_MESSAGES.formato });
    expect(parseCuit("201234567861")).toEqual({ error: CUIT_MESSAGES.formato });
    expect(parseCuit("")).toEqual({ error: CUIT_MESSAGES.formato });
    expect(parseCuit("abc")).toEqual({ error: CUIT_MESSAGES.formato });
  });

  it("normaliza y formatea", () => {
    expect(normalizeCuit("20-12345678-6")).toBe("20123456786");
    expect(formatCuit("20123456786")).toBe("20-12345678-6");
    expect(formatCuit("123")).toBe("123");
    expect(formatCuit(null)).toBe("");
  });
});
