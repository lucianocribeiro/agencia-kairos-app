import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  byteLength,
  checkNewPassword,
  comparePassword,
  DUMMY_HASH,
  hashNewPassword,
  InvalidPasswordError,
  PASSWORD_POLICY_MESSAGES,
} from "./password";

afterEach(() => vi.restoreAllMocks());

const LARGA = "La contraseña no puede superar los 72 bytes (los caracteres con tilde o emojis ocupan más de uno).";

describe("política de contraseñas nuevas (72 bytes)", () => {
  it("72 bytes ASCII pasa, 73 no", () => {
    expect(checkNewPassword("a".repeat(72))).toBeNull();
    expect(checkNewPassword("a".repeat(73))).toBe(LARGA);
    expect(PASSWORD_POLICY_MESSAGES.larga).toBe(LARGA);
  });

  it("multibyte: ñ = 2 bytes", () => {
    expect(byteLength("ñ")).toBe(2);
    expect(checkNewPassword("ñ".repeat(36))).toBeNull(); // 72 bytes
    expect(checkNewPassword("ñ".repeat(36) + "a")).toBe(LARGA); // 73 bytes
    expect(checkNewPassword("a".repeat(70) + "ñ")).toBeNull(); // 72
    expect(checkNewPassword("a".repeat(71) + "ñ")).toBe(LARGA); // 73
  });

  it("multibyte: emoji = 4 bytes", () => {
    expect(byteLength("🔑")).toBe(4);
    expect(checkNewPassword("🔑".repeat(18))).toBeNull(); // 72 bytes, 18 caracteres
    expect(checkNewPassword("a".repeat(68) + "🔑")).toBeNull(); // 72
    expect(checkNewPassword("a".repeat(69) + "🔑")).toBe(LARGA); // 73
  });

  it("mínimo 10 caracteres (no bytes)", () => {
    expect(checkNewPassword("a".repeat(9))).toBe(PASSWORD_POLICY_MESSAGES.corta);
    expect(checkNewPassword("🔑".repeat(9))).toBe(PASSWORD_POLICY_MESSAGES.corta); // 36 bytes pero 9 caracteres
    expect(checkNewPassword("a".repeat(10))).toBeNull();
  });

  it("hashNewPassword valida antes de hashear y nunca trunca", async () => {
    const spy = vi.spyOn(bcrypt, "hash");
    await expect(hashNewPassword("a".repeat(73))).rejects.toBeInstanceOf(InvalidPasswordError);
    await expect(hashNewPassword("corta")).rejects.toThrow(PASSWORD_POLICY_MESSAGES.corta);
    expect(spy).not.toHaveBeenCalled();
    const hash = await hashNewPassword("ñ".repeat(36));
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare("ñ".repeat(36), hash)).toBe(true);
  }, 20_000);
});

describe("comparePassword", () => {
  it("más de 72 bytes nunca coincide, aunque los primeros 72 sí, y compara igual contra el hash fijo", async () => {
    const base = "a".repeat(72);
    const hash = await bcrypt.hash(base, 4);
    expect(await comparePassword(base, hash)).toBe(true);
    const spy = vi.spyOn(bcrypt, "compare");
    expect(await comparePassword(base + "X", hash)).toBe(false); // bcrypt truncaría y daría true
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(DUMMY_HASH);
  });

  it("sin hash compara contra el hash fijo y da false", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    expect(await comparePassword("lo-que-sea", null)).toBe(false);
    expect(spy.mock.calls[0][1]).toBe(DUMMY_HASH);
  });
});
