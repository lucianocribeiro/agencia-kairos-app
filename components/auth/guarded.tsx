import { Suspense, type ReactNode } from "react";

import { requireAdmin, requireUser } from "@/lib/auth/guards";

/**
 * Corre el guard antes de renderizar `children`. Va en cada página protegida
 * (no alcanza con el layout: los layouts no se re-renderizan al navegar).
 * La sesión se lee en request time, por eso va dentro de <Suspense>.
 */
export function Guarded({ admin = false, children }: { admin?: boolean; children: ReactNode }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <GuardedContent admin={admin}>{children}</GuardedContent>
    </Suspense>
  );
}

async function GuardedContent({ admin, children }: { admin: boolean; children: ReactNode }) {
  if (admin) await requireAdmin();
  else await requireUser();
  return <>{children}</>;
}

export function PageSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto flex w-full max-w-6xl animate-pulse flex-col gap-6">
      <div className="h-8 w-48 rounded bg-card" />
      <div className="h-40 rounded-lg bg-surface" />
    </div>
  );
}
