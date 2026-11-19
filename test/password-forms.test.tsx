// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROOT, sourceFiles } from "./source-files";

/**
 * CC-F4-10 (F4-10): una contraseña nunca puede terminar en una URL. Un envío nativo (antes de
 * hidratar o sin JS) de un formulario sin `method` es un GET con los campos en la query.
 */

vi.mock("@/lib/airtable/client", () => ({
  getAirtableClient: () => {
    throw new Error("la ruta sin-js no puede tocar Airtable");
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { LoginForm } = await import("@/components/auth/login-form");
const { PasswordForm } = await import("@/components/auth/password-form");
const sinJs = await import("@/app/api/auth/sin-js/route");
const login = await import("@/app/api/auth/login/route");
const { NO_JS_PATH } = await import("@/lib/no-js-form");

const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const FILES = [...sourceFiles("app"), ...sourceFiles("components")].filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));

/** Componentes que tienen un campo de contraseña (type="password" o la contraseña temporal de Usuarios). */
const PASSWORD_COMPONENTS = ["LoginForm", "PasswordForm", "ArcaSyncDialog", "TemporaryPassword"];
const hasPasswordInput = (code: string) => /type="password"/.test(code) || /<TemporaryPassword\b/.test(code);

/** Rangos [inicio, fin) de cada <form …>…</form> del archivo, con su tag de apertura. */
function forms(code: string): { start: number; end: number; tag: string }[] {
  const out: { start: number; end: number; tag: string }[] = [];
  const re = /<form\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const end = code.indexOf("</form>", m.index);
    out.push({ start: m.index, end: end < 0 ? code.length : end, tag: m[0] });
  }
  return out;
}
const safeTag = (tag: string) => /method="post"/.test(tag) && /action=\{noJsAction\("[a-z-]+"\)\}/.test(tag) && !/method="get"/i.test(tag);

describe("formularios con contraseña: siempre POST a la ruta segura, o fuera de todo <form>", () => {
  const conPassword = FILES.filter((f) => hasPasswordInput(read(f)));

  it("encuentra los campos de contraseña conocidos", () => {
    expect(conPassword.sort()).toEqual(["components/abm/usuarios-manager.tsx", "components/auth/login-form.tsx", "components/auth/password-form.tsx", "components/importar/arca-sync-dialog.tsx"]);
  });

  it.each(FILES)("%s", (file) => {
    const code = read(file);
    const fs = forms(code);
    // 1. Un campo de contraseña dentro de un <form> del mismo archivo → ese form es POST seguro.
    if (hasPasswordInput(code)) {
      const positions = [...code.matchAll(/type="password"|<TemporaryPassword\b/g)].map((m) => m.index!);
      for (const pos of positions) {
        const enclosing = fs.find((f) => f.start < pos && pos < f.end);
        if (enclosing) expect(safeTag(enclosing.tag), `${file}: <form> con contraseña sin method="post" seguro`).toBe(true);
      }
    }
    // 2. Un componente con contraseña usado dentro de un <form> de otro archivo → ese form es POST seguro.
    for (const name of PASSWORD_COMPONENTS) {
      for (const m of code.matchAll(new RegExp(`<${name}\\b`, "g"))) {
        const enclosing = fs.find((f) => f.start < m.index! && m.index! < f.end);
        if (enclosing && !hasPasswordInput(code.slice(enclosing.start, enclosing.end).replace(new RegExp(`<${name}\\b`, "g"), ""))) {
          expect(safeTag(enclosing.tag), `${file}: <${name}> dentro de un <form> sin method="post" seguro`).toBe(true);
        }
      }
    }
  });

  it("el diálogo de ARCA no tiene <form> (fetch con JSON) y no está dentro del <form> del Excel", () => {
    const dialog = read("components/importar/arca-sync-dialog.tsx");
    expect(forms(dialog)).toEqual([]);
    expect(dialog).toMatch(/method: "POST",[\s\S]*?body: JSON\.stringify\(\{ desde, hasta, usuario, clave \}\)/);
    const manager = read("components/importar/import-manager.tsx");
    const pos = manager.indexOf("<ArcaSyncDialog");
    expect(pos).toBeGreaterThan(0);
    expect(forms(manager).some((f) => f.start < pos && pos < f.end)).toBe(false);
  });

  it("ningún fetch ni navegación arma una URL con credenciales", () => {
    for (const file of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")].filter((f) => /\.(tsx?|mjs)$/.test(f) && !/\.test\./.test(f))) {
      const code = read(file);
      expect(code, file).not.toMatch(/[?&](password|clave|actual|nueva|repetir)=/);
      expect(code, file).not.toMatch(/searchParams\.(set|append)\(\s*["'](password|clave|actual|nueva|repetir)["']/);
    }
  });
});

describe("el botón de envío está deshabilitado en el HTML del servidor y se habilita al hidratar", () => {
  afterEach(() => document.body.replaceChildren());

  it.each([
    ["login", () => <LoginForm />, "/api/auth/sin-js?volver=login"],
    ["cambiar contraseña", () => <PasswordForm />, "/api/auth/sin-js?volver=cambiar-password"],
  ])("%s", async (_l, render, action) => {
    const html = renderToString(render());
    const tag = /<form\b[^>]*>/.exec(html)![0];
    expect(tag).toContain('method="post"');
    expect(tag).toContain(`action="${action}"`);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toContain("<noscript>");

    // Después de hidratar (render en el cliente), el botón se habilita.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(render()));
    const button = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBe(false);
    expect(container.querySelector("form")!.getAttribute("method")).toBe("post");
    act(() => root.unmount());
  });
});

describe("POST nativo (sin JS) a /api/auth/sin-js", () => {
  const post = (query: string, body: string) =>
    sinJs.POST(new NextRequest(`http://localhost${NO_JS_PATH}${query}`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }), { params: Promise.resolve({}) } as never);

  it("no intenta el login, no lee ni devuelve los campos: 303 a la misma página sin query", async () => {
    const spies = (["log", "error", "warn", "info"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const secreto = "Clave-QA-que-no-sale-9";
    for (const [volver, path] of [["login", "/login"], ["cambiar-password", "/cambiar-password"], ["usuarios", "/usuarios"], ["otra", "/login"], ["__proto__", "/login"], ["", "/login"]]) {
      const res = await post(volver ? `?volver=${volver}` : "", `email=qa%40example.com&password=${secreto}&robot=on`);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`http://localhost${path}`);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("set-cookie")).toBeNull();
      const text = await res.text();
      expect(text).not.toContain(secreto);
      expect(text).not.toContain("qa@example.com");
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });

  it("solo POST (un GET no tiene handler → 405 de Next)", () => {
    expect(Object.keys(sinJs)).toEqual(["POST"]);
  });

  it("y la API de login tampoco acepta un formulario nativo (415, sin leerlo como login)", async () => {
    const res = await login.POST(new NextRequest("http://localhost/api/auth/login", { method: "POST", body: "email=a%40b.c&password=x", headers: { "content-type": "application/x-www-form-urlencoded" } }), {} as never);
    expect(res.status).toBe(415);
  });
});
