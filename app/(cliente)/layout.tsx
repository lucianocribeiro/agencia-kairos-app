import { Suspense } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { requireCliente } from "@/lib/auth/guards";

/** Shell del rol Cliente (un solo ítem: «Horas»). La autorización de cada página la hace su propio guard. */
export default function ClienteLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const user = await requireCliente();
  return <AppShell user={{ nombre: user.nombre, rol: user.rol }}>{children}</AppShell>;
}
