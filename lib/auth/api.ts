import "server-only";

import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { AirtableError, summarizeError } from "@/lib/airtable/errors";
import { runInApiContext } from "./api-context";
import { AuthError, requireAdmin, requireUser } from "./guards";
import { clearSessionCookie, type SessionUser } from "./session";
import { describeError } from "./users";

export const API_MESSAGES = {
  noEncontrado: "No encontramos el registro.",
  noDisponible: "Airtable no está disponible. Probá de nuevo en unos minutos.",
  error: "Ocurrió un error. Probá de nuevo.",
} as const;

type Handler<C> = (request: NextRequest, context: C) => Promise<Response>;

export interface RouteOptions {
  /** Toda respuesta de la ruta (éxito y errores, también los 500 del catch) lleva Cache-Control: no-store. */
  noStore?: boolean;
}

/** Único lugar que pone Cache-Control: no-store (respuestas de guards, reportes). Devuelve la misma respuesta. */
export function withNoStore<T extends Response>(res: T): T {
  res.headers.set("cache-control", "no-store");
  return res;
}
type GuardedHandler<C> = (request: NextRequest, user: SessionUser, context: C) => Promise<Response>;

/**
 * Envoltorio base de todo Route Handler de la app.
 * - Los guards responden 401/403 en JSON (y borran la cookie si era inválida).
 * - AirtableError: not_found → 404; 429/5xx (después de los reintentos) y
 *   errores de red → 503; el resto (incluido 422) → 500 genérico.
 * - Cualquier otro error → 500 genérico, sin detalles internos.
 * Los logs solo llevan código/status/tipo: nunca bodies, mensajes de la API ni el token.
 * Las rutas públicas de auth lo usan directo; el resto usa adminRoute / userRoute.
 * Los 401/403 de los guards siempre llevan Cache-Control: no-store; con `noStore`, todas las respuestas.
 */
export function apiRoute<C = unknown>(handler: Handler<C>, options: RouteOptions = {}): Handler<C> {
  return (request, context) =>
    runInApiContext(async () => {
      const res = await handle(handler, request, context);
      return options.noStore ? withNoStore(res) : res;
    });
}

async function handle<C>(handler: Handler<C>, request: NextRequest, context: C): Promise<Response> {
  try {
    return await handler(request, context);
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AuthError) {
      const res = withNoStore(NextResponse.json({ error: err.message }, { status: err.status }));
      if (err.clearCookie) clearSessionCookie(res);
      return res;
    }
    if (err instanceof AirtableError) {
      console.error("[api] Error de Airtable", summarizeError(err));
      if (err.code === "not_found") return NextResponse.json({ error: API_MESSAGES.noEncontrado }, { status: 404 });
      if (err.retryable) return NextResponse.json({ error: API_MESSAGES.noDisponible }, { status: 503 });
      return NextResponse.json({ error: API_MESSAGES.error }, { status: 500 });
    }
    console.error("[api] Error no controlado", describeError(err));
    return NextResponse.json({ error: API_MESSAGES.error }, { status: 500 });
  }
}

/**
 * Obligatorio para todo método exportado en app/api/admin/**:
 *   export const GET = adminRoute(async (request, user) => { ... })
 * Corre requireAdmin() antes del handler. Lo verifica test/route-guards.test.ts (AST).
 */
export function adminRoute<C = unknown>(handler: GuardedHandler<C>, options: RouteOptions = {}): Handler<C> {
  return apiRoute<C>(async (request, context) => handler(request, await requireAdmin(), context), options);
}

/**
 * Obligatorio para todo método exportado en app/api/me/**:
 *   export const GET = userRoute(async (request, user) => { ... })
 * Corre requireUser() antes del handler. Las respuestas pasan por lib/airtable/access.ts.
 */
export function userRoute<C = unknown>(handler: GuardedHandler<C>, options: RouteOptions = {}): Handler<C> {
  return apiRoute<C>(async (request, context) => handler(request, await requireUser(), context), options);
}

export const REQUEST_MESSAGES = {
  formato: "El formato del pedido no es válido.",
} as const;

/**
 * Lee un body JSON. Sin `Content-Type: application/json` → 415 (corta formularios
 * HTML cross-site); JSON inválido o que no sea un objeto → 400. Devuelve el body
 * o la Response de error lista para devolver.
 */
export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown> | Response> {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/json")) {
    return NextResponse.json({ error: REQUEST_MESSAGES.formato }, { status: 415 });
  }
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // cae al 400
  }
  return NextResponse.json({ error: REQUEST_MESSAGES.formato }, { status: 400 });
}
