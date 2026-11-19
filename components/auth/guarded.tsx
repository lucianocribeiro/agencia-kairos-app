import { Suspense, type ReactNode } from "react";

import { Cargando } from "@/components/shell/cargando";
import { requireAdmin, requireCliente, requireUser } from "@/lib/auth/guards";

/**
 * Corre el guard antes de renderizar `children`. Va en cada página protegida
 * (no alcanza con el layout: los layouts no se re-renderizan al navegar).
 * La sesión se lee en request time, por eso va dentro de <Suspense>.
 * Sin props: Admin o Empleado (un Cliente va a su vista). `admin`: solo Admin. `cliente`: solo Cliente.
 */
export function Guarded({ admin = false, cliente = false, children }: { admin?: boolean; cliente?: boolean; children: ReactNode }) {
  return (
    // CC-F4-13: mientras carga la página, la «K» girando (después de 300 ms).
    <Suspense fallback={<Cargando />}>
      <GuardedContent admin={admin} cliente={cliente}>
        {children}
      </GuardedContent>
    </Suspense>
  );
}

async function GuardedContent({ admin, cliente, children }: { admin: boolean; cliente: boolean; children: ReactNode }) {
  if (cliente) await requireCliente();
  else if (admin) await requireAdmin();
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
