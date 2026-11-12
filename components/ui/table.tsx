import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/** Tabla con scroll horizontal propio, para no romper el ancho de la página en mobile. */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-line">
      <table className={cn("w-full border-collapse text-left text-sm", className)} {...props} />
    </div>
  );
}

export function TableHead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-surface text-xs uppercase tracking-wide text-muted", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line bg-card", className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("hover:bg-surface/60", className)} {...props} />;
}

export function TableHeaderCell({ className, scope = "col", ...props }: ComponentProps<"th">) {
  return <th scope={scope} className={cn("px-4 py-3 font-medium", className)} {...props} />;
}

export function TableCell({ className, numeric, ...props }: ComponentProps<"td"> & { numeric?: boolean }) {
  return <td className={cn("px-4 py-3", numeric && "text-right tabular-nums", className)} {...props} />;
}

export function TableEmpty({ colSpan, children = "No hay datos para mostrar." }: { colSpan: number; children?: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-muted">
        {children}
      </td>
    </tr>
  );
}
