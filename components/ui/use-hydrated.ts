"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false en el HTML del servidor (y durante la hidratación), true una vez que React tomó la
 * página. Los botones de envío de los formularios con contraseña se deshabilitan hasta entonces
 * (CC-F4-10): así ni un clic ni Enter pueden enviar el formulario de forma nativa.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
