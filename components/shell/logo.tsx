"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/cn";

/**
 * Tamaños del logo (PNG 1700×812, proporción ≈ 2,09:1) dentro de su caja fija:
 * - expandido: caja de 180×56 px → 118×56
 * - compacto (sidebar colapsado, 72 px de ancho): caja de 56×56 px → 56×27
 * `width`/`height` le dan a next/image el tamaño real que se muestra, así el
 * optimizador sirve una imagen chica (1x/2x) en vez del PNG original.
 */
export const LOGO_SIZES = {
  expanded: { width: 118, height: 56 },
  compact: { width: 56, height: 27 },
} as const;

/**
 * Logo `/Logo.png` con next/image. Si el archivo no existe o falla, muestra
 * "Kairos" en el mismo espacio (contenedor de tamaño fijo: no hay layout shift).
 * next/image vuelve a disparar `onError` después de hidratar si la imagen falló antes.
 *
 * `eager`: para el shell (siempre arriba de todo). En Next 16 `priority` está
 * deprecado; se usa `loading="eager"` + `fetchPriority="high"`, que es lo que
 * recomienda la doc cuando hay más de una instancia (sidebar y header mobile).
 */
export function Logo({ compact = false, eager = false, className }: { compact?: boolean; eager?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  const size = compact ? LOGO_SIZES.compact : LOGO_SIZES.expanded;

  return (
    <span
      className={cn(
        "flex h-14 shrink-0 items-center overflow-hidden",
        compact ? "w-14 justify-center" : "w-[180px]",
        className,
      )}
    >
      {failed ? (
        <span className={cn("font-semibold tracking-tight text-white", compact ? "text-[15px]" : "text-[28px]")}>
          Kairos
        </span>
      ) : (
        <Image
          src="/Logo.png"
          alt="Kairos"
          width={size.width}
          height={size.height}
          {...(eager ? { loading: "eager" as const, fetchPriority: "high" as const } : {})}
          className="h-auto max-h-full w-auto max-w-full object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
