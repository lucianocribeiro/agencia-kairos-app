import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";

import { signSessionToken, verifySessionToken } from "./token";

const SECRET = "k".repeat(44);
const data = { userId: "recAAAAAAAAAAAAAA", pf: "0123456789abcdef" };

describe("token de sesión", () => {
  it("payload: solo sub, iat y pf", async () => {
    const token = await signSessionToken(data, SECRET);
    expect(Object.keys(decodeJwt(token)).sort()).toEqual(["iat", "pf", "sub"]);
    expect(await verifySessionToken(token, SECRET)).toMatchObject({ sub: data.userId, pf: data.pf });
  });

  it("vence a las 12 h (sin sliding)", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const token = await signSessionToken(data, SECRET, iat);
    expect(await verifySessionToken(token, SECRET, new Date((iat + 11 * 3600) * 1000))).not.toBeNull();
    expect(await verifySessionToken(token, SECRET, new Date((iat + 12 * 3600 + 1) * 1000))).toBeNull();
  });

  it("rechaza otro secreto, token alterado, vacío o iat futuro", async () => {
    const token = await signSessionToken(data, SECRET);
    expect(await verifySessionToken(token, "z".repeat(44))).toBeNull();
    expect(await verifySessionToken(`${token.slice(0, -2)}xx`, SECRET)).toBeNull();
    expect(await verifySessionToken(undefined, SECRET)).toBeNull();
    expect(await verifySessionToken(token, undefined)).toBeNull();
    const future = await signSessionToken(data, SECRET, Math.floor(Date.now() / 1000) + 3600);
    expect(await verifySessionToken(future, SECRET)).toBeNull();
  });
});
