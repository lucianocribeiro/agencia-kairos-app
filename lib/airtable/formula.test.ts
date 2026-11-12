import { describe, expect, it } from "vitest";

import { and, eq, escapeFormulaString, field, formula, or, recordIdIs } from "./formula";

const EMAIL = "fld6Opt1EZhun7vKN";
const ESTADO = "fldrlPu1qQZVtTjKw";

describe("formula", () => {
  it("escapa comillas y barras invertidas", () => {
    expect(escapeFormulaString('a"b')).toBe('a\\"b');
    expect(escapeFormulaString("a\\b")).toBe("a\\\\b");
    expect(escapeFormulaString('\\"')).toBe('\\\\\\"');
    expect(escapeFormulaString("a\nb")).toBe("a\\nb");
  });

  it("referencia campos por ID", () => {
    expect(field(EMAIL).toString()).toBe(`{${EMAIL}}`);
    expect(() => field("Email")).toThrow();
    expect(() => field("fld}{x")).toThrow();
  });

  it("interpola y escapa input del usuario", () => {
    const malicious = '") , TRUE(), ("';
    expect(eq(EMAIL, malicious).toString()).toBe(`{${EMAIL}} = "\\") , TRUE(), (\\""`);
  });

  it("literales tipados", () => {
    expect(formula`${field(ESTADO)} = ${1.5}`.toString()).toBe(`{${ESTADO}} = 1.5`);
    expect(formula`${true}`.toString()).toBe("TRUE()");
    expect(formula`${null}`.toString()).toBe("BLANK()");
    expect(() => formula`${Number.NaN}`).toThrow();
  });

  it("AND / OR", () => {
    expect(and(eq(EMAIL, "a@b.com"), eq(ESTADO, "Activo")).toString()).toBe(
      `AND({${EMAIL}} = "a@b.com", {${ESTADO}} = "Activo")`,
    );
    expect(or(eq(ESTADO, "A"), eq(ESTADO, "B")).toString()).toBe(`OR({${ESTADO}} = "A", {${ESTADO}} = "B")`);
  });

  it("recordIdIs valida el ID", () => {
    expect(recordIdIs("rec0123456789abcd").toString()).toBe('RECORD_ID() = "rec0123456789abcd"');
    expect(() => recordIdIs('rec") OR TRUE() OR ("')).toThrow();
  });
});
