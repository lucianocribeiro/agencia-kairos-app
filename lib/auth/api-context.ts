import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Marca que el código corre dentro de un Route Handler envuelto con
 * `apiRoute()`. Los guards lo usan para responder JSON (401/403) en vez de
 * redirigir.
 */
const storage = new AsyncLocalStorage<true>();

export function runInApiContext<T>(fn: () => T): T {
  return storage.run(true, fn);
}

export function isApiContext(): boolean {
  return storage.getStore() === true;
}
