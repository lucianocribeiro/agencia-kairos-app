/**
 * Formularios con contraseña sin JavaScript (CC-F4-10 / F4-10). Client-safe.
 *
 * Todo `<form>` con una contraseña lleva `method="post"` y `action={noJsAction(destino)}`: si el
 * navegador lo envía de forma nativa (antes de hidratar o sin JS), va por POST (nunca un GET con
 * los campos en la URL) a una ruta que NO lee el body, no intenta ningún login y redirige (303) a
 * la misma página, sin query. El envío normal es siempre por fetch con JSON (onSubmit + preventDefault).
 */
export const NO_JS_DESTINOS = {
  login: "/login",
  "cambiar-password": "/cambiar-password",
  usuarios: "/usuarios",
} as const;

export type NoJsDestino = keyof typeof NO_JS_DESTINOS;

export const NO_JS_PATH = "/api/auth/sin-js";

export const noJsAction = (destino: NoJsDestino) => `${NO_JS_PATH}?volver=${destino}`;

export const NO_JS_MESSAGE = "Activá JavaScript en el navegador para continuar.";
