import Image from "next/image";

/**
 * Indicador de carga de página (CC-F4-13): la «K» de Kairos (`/klogo-transparente.png`) girando en el área de
 * contenido mientras carga la página siguiente. Va como fallback de `<Guarded>` (el Suspense de cada
 * página protegida, que es lo que se ve al navegar con cacheComponents/PPR) y en los `loading.tsx`
 * de los grupos (admin), (empleado) y (cliente); sidebar y header quedan visibles. No va en el login.
 *
 * - Demora (300 ms, `CARGANDO_DELAY_MS`): solo CSS, con la animación `cargando-aparece`
 *   (app/globals.css): durante la demora el indicador está `visibility: hidden` + opacidad 0, así no
 *   se ve NI se anuncia a lectores de pantalla; después aparece en 150 ms. La animación cuenta desde
 *   que el elemento se MUESTRA (se reinicia al pasar de display:none a visible). Con cacheComponents,
 *   Next puede montar el fallback antes de navegar dentro de una ruta oculta con <Activity>; un timer
 *   de JS contaría desde ese montaje y la K aparecería antes de los 300 ms (medido en el smoke).
 * - Giro: una vuelta cada 1,2 s, lineal y continuo, sobre su centro; con prefers-reduced-motion, quieta.
 * - Accesibilidad: role="status" con «Cargando…» para lectores de pantalla; la imagen es decorativa.
 * - Asset (CC-F4-13-FIX): `/klogo-transparente.png`, derivado de `public/klogo.png` (564×526, K negra
 *   sobre transparencia, bordes con alpha proporcional). Color por tema como el logo del header (solo
 *   CSS, el archivo no cambia): blanca en oscuro (`invert`), negra en claro (`light:invert-0`).
 *   `public/klogo.png` queda en el repo como fuente y la app no lo usa.
 */
export const CARGANDO_DELAY_MS = 300;
/** Ancho × alto mostrados (proporción del PNG, 564×526). */
export const CARGANDO_SIZE = { width: 96, height: 90 } as const;
export const CARGANDO_TEXTO = "Cargando…";
/** Aparición: 150 ms de opacidad, después de `CARGANDO_DELAY_MS` (300 ms). */
export const CARGANDO_APARECE = "animate-[cargando-aparece_150ms_ease-out_300ms_both]";
/** Giro: una vuelta cada 1,2 s; quieta con prefers-reduced-motion. */
export const CARGANDO_GIRO = "animate-[spin_1.2s_linear_infinite] motion-reduce:animate-none";
/** Color por tema: el PNG es negro; blanca en oscuro (default), negra en claro. */
export const CARGANDO_TEMA = "invert light:invert-0";
export const CARGANDO_SRC = "/klogo-transparente.png";

export function Cargando() {
  return (
    <div role="status" className={`flex min-h-[calc(100dvh-7.5rem)] w-full items-center justify-center ${CARGANDO_APARECE}`}>
      <Image src={CARGANDO_SRC} alt="" aria-hidden="true" width={CARGANDO_SIZE.width} height={CARGANDO_SIZE.height} className={`${CARGANDO_GIRO} ${CARGANDO_TEMA}`} />
      <span className="sr-only">{CARGANDO_TEXTO}</span>
    </div>
  );
}
