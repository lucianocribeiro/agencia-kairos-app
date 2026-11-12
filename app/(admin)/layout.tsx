import { Suspense } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { requireAdmin } from "@/lib/auth/guards";

/** Shell con el rol de la sesión. La autorización de cada página la hace su propio guard. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return <AppShell user={{ nombre: user.nombre, rol: user.rol }}>{children}</AppShell>;
}
