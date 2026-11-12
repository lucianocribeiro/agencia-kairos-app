"use client";

import { useCallback, useState } from "react";

import { cn } from "@/lib/cn";

/**
 * Logo `/Logo.png`. Si el archivo no existe o falla, muestra "Kairos" en el
 * mismo espacio (contenedor de tamaño fijo: no hay layout shift).
 */
export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);

  // Si la imagen falló antes de hidratar, onError no se dispara: se detecta acá.
  const checkLoaded = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  return (
    <span
      className={cn(
        "flex h-10 shrink-0 items-center overflow-hidden",
        compact ? "w-10 justify-center" : "w-32",
        className,
      )}
    >
      {failed ? (
        <span className={cn("font-semibold tracking-tight text-white", compact ? "text-[11px]" : "text-xl")}>
          Kairos
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- necesitamos onError para el fallback de texto
        <img
          ref={checkLoaded}
          src="/Logo.png"
          alt="Kairos"
          className="max-h-full max-w-full object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
