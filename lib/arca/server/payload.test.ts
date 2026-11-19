import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { MAX_PAYLOAD_CHARS, PAYLOAD_DOMAIN, PAYLOAD_MESSAGES, PAYLOAD_TTL_MS, signPayload, verifyPayload } from "./payload";

const SECRET = "s".repeat(44);
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);
const claims = { syncId: "rec00000000000001", tabla: "ventas" as const, userId: "rec00000000000009", issuedAt: NOW };
const expected = { syncId: claims.syncId, tabla: claims.tabla, userId: claims.userId };
const rows = [{ "Imp. Total": "1000,00", "Número Desde": "1" }];

describe("payload firmado", () => {
  it("firma y verifica (ida y vuelta)", () => {
    const token = signPayload(SECRET, claims, rows)!;
    expect(verifyPayload(SECRET, token, expected, NOW + 1000)).toEqual({ ok: true, claims, rows });
  });

  it("la clave es HMAC(SESSION_SECRET, dominio), nunca el secreto crudo", () => {
    const token = signPayload(SECRET, claims, rows)!;
    const [data, sig] = token.split(".");
    const raw = createHmac("sha256", SECRET).update(data).digest("base64url");
    expect(sig).not.toBe(raw);
    const derived = createHmac("sha256", createHmac("sha256", SECRET).update(PAYLOAD_DOMAIN).digest()).update(data).digest("base64url");
    expect(sig).toBe(derived);
  });

  it("alterado (datos o firma), otro secreto o basura → 400 «no es válida»", () => {
    const token = signPayload(SECRET, claims, rows)!;
    const [data, sig] = token.split(".");
    const tampered = Buffer.from(Buffer.from(data, "base64url").toString().replace("1000,00", "9000,00")).toString("base64url");
    const bad = { ok: false, status: 400, error: PAYLOAD_MESSAGES.invalido };
    expect(verifyPayload(SECRET, `${tampered}.${sig}`, expected, NOW)).toEqual(bad);
    expect(verifyPayload(SECRET, `${data}.${sig.slice(0, -2)}AA`, expected, NOW)).toEqual(bad);
    expect(verifyPayload("o".repeat(44), token, expected, NOW)).toEqual(bad);
    for (const junk of [undefined, 42, "", "sin-punto", ".x", "x".repeat(MAX_PAYLOAD_CHARS + 1)]) expect(verifyPayload(SECRET, junk, expected, NOW)).toEqual(bad);
  });

  it("otro usuario → 403; otra sincronización u otra tabla → 400", () => {
    const token = signPayload(SECRET, claims, rows)!;
    expect(verifyPayload(SECRET, token, { ...expected, userId: "rec00000000000008" }, NOW)).toEqual({ ok: false, status: 403, error: PAYLOAD_MESSAGES.otroUsuario });
    expect(verifyPayload(SECRET, token, { ...expected, syncId: "rec00000000000002" }, NOW)).toEqual({ ok: false, status: 400, error: PAYLOAD_MESSAGES.otraSincronizacion });
    expect(verifyPayload(SECRET, token, { ...expected, tabla: "compras" }, NOW)).toEqual({ ok: false, status: 400, error: PAYLOAD_MESSAGES.otraSincronizacion });
  });

  it("más de 2 horas → 400 «venció»; emitido en el futuro → también", () => {
    const token = signPayload(SECRET, claims, rows)!;
    expect(verifyPayload(SECRET, token, expected, NOW + PAYLOAD_TTL_MS)).toMatchObject({ ok: true });
    expect(verifyPayload(SECRET, token, expected, NOW + PAYLOAD_TTL_MS + 1)).toEqual({ ok: false, status: 400, error: PAYLOAD_MESSAGES.vencido });
    expect(verifyPayload(SECRET, token, expected, NOW - 120_000)).toEqual({ ok: false, status: 400, error: PAYLOAD_MESSAGES.vencido });
  });

  it("más de 3,5 MB → null (la vista previa lo rechaza)", () => {
    const big = Array.from({ length: 1000 }, (_, i) => ({ texto: "x".repeat(3000), n: String(i) }));
    expect(signPayload(SECRET, claims, big)).toBeNull();
  });
});
