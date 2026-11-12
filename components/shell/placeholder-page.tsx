import { Construction } from "lucide-react";
import type { ReactNode } from "react";

/** Página provisoria: título + "En construcción". */
export function PlaceholderPage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line bg-surface px-6 py-14 text-center">
        <Construction aria-hidden="true" className="size-8 text-muted" />
        <p className="text-sm text-muted">En construcción</p>
      </div>
      {children}
    </div>
  );
}
