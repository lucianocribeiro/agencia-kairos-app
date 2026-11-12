import "server-only";

import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { runInApiContext } from "./api-context";
import { AuthError } from "./guards";
import { clearSessionCookie } from "./session";
import { describeError } from "./users";

type Handler<C> = (request: NextRequest, context: C) => Promise<Response>;

/**
 * Envoltorio obligatorio de todo Route Handler de la app.
 * - Los guards responden 401/403 en JSON (y borran la cookie si era inválida).
 * - Cualquier otro error → 500 genérico, sin detalles internos.
 */
export function apiRoute<C = unknown>(handler: Handler<C>): Handler<C> {
  return (request, context) =>
    runInApiContext(async () => {
      try {
        return await handler(request, context);
      } catch (err) {
        unstable_rethrow(err);
        if (err instanceof AuthError) {
          const res = NextResponse.json({ error: err.message }, { status: err.status });
          if (err.clearCookie) clearSessionCookie(res);
          return res;
        }
        console.error("[api] Error no controlado", describeError(err));
        return NextResponse.json({ error: "Ocurrió un error. Probá de nuevo." }, { status: 500 });
      }
    });
}

/** Lee un body JSON. Exige Content-Type application/json (corta formularios cross-site). */
export async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
