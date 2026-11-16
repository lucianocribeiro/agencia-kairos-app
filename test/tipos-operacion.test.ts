import { describe, expect, it } from "vitest";

import { MAESTRO_SPECS, TIPO_PROTEGIDO_MESSAGES } from "@/lib/abm/maestros";
import { TIPO_COBRO, TIPO_PAGO } from "@/lib/reportes/saldos";
import { TIPOS_SOCIO } from "@/lib/reportes/socios";
import { TIPO_TRANSFERENCIA } from "@/lib/tesoreria/rules";
import { TIPOS_OPERACION, TIPOS_OPERACION_PROTEGIDOS } from "@/lib/tipos-operacion";
import { read, sourceFiles } from "./source-files";

/** CC-F4-02: una sola constante con los 6 tipos de operación que la app busca por nombre. */
const NOMBRES = [
  "Transferencia entre cuentas propias",
  "Retiro de socio",
  "Gasto particular de socio",
  "Aporte de socio",
  "Cobro a cliente",
  "Pago a proveedor",
];

describe("TIPOS_OPERACION (CC-F4-02)", () => {
  it("tiene exactamente los 6 nombres de la base", () => {
    expect([...TIPOS_OPERACION_PROTEGIDOS]).toEqual(NOMBRES);
  });

  it("Tesorería y los Reportes leen los nombres de la constante", () => {
    expect(TIPO_TRANSFERENCIA).toBe(TIPOS_OPERACION.transferencia);
    expect(TIPOS_SOCIO).toEqual({ retiro: TIPOS_OPERACION.retiroSocio, gasto: TIPOS_OPERACION.gastoSocio, aporte: TIPOS_OPERACION.aporteSocio });
    expect(TIPO_COBRO).toBe(TIPOS_OPERACION.cobroCliente);
    expect(TIPO_PAGO).toBe(TIPOS_OPERACION.pagoProveedor);
    for (const file of ["lib/reportes/socios.ts", "lib/reportes/saldos.ts", "lib/tesoreria/rules.ts", "lib/abm/maestros.ts"]) {
      expect(read(file)).toContain('from "@/lib/tipos-operacion"');
    }
  });

  it("Maestros › Tipos de operación protege exactamente esos 6 (la transferencia, además, Movimiento/Suma/Es de socio)", () => {
    const p = MAESTRO_SPECS["tipos-de-operacion"].protegido!;
    expect(p.key).toBe("nombre");
    expect(p.reglas.map((r) => r.value)).toEqual(NOMBRES);
    for (const r of p.reglas) {
      if (r.value === TIPOS_OPERACION.transferencia) {
        expect(r).toMatchObject({ keys: ["nombre", "movimiento", "sumaAResultados", "esDeSocio"], mensaje: TIPO_PROTEGIDO_MESSAGES.transferencia });
      } else {
        expect(r).toMatchObject({ keys: ["nombre"], mensaje: TIPO_PROTEGIDO_MESSAGES.reportes, borrar: TIPO_PROTEGIDO_MESSAGES.reportes });
      }
    }
  });

  const FILES = ["lib", "app"].flatMap((d) => sourceFiles(d)).filter((f) => f !== "lib/tipos-operacion.ts" && !/\.test\.tsx?$/.test(f));
  it("hay archivos para revisar", () => expect(FILES.length).toBeGreaterThan(50));
  // Exacto, como los busca la app (en minúscula, «transferencia entre cuentas propias» es texto de UI).
  it.each(FILES)("%s no repite ninguno de los 6 nombres", (file) => {
    const code = read(file);
    expect(NOMBRES.filter((n) => code.includes(n))).toEqual([]);
  });
});
