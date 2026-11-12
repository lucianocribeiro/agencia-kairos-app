import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PasswordForm } from "@/components/auth/password-form";
import { PageSkeleton } from "@/components/auth/guarded";
import { buttonClasses, Card, CardContent, CardDescription, CardHeader, CardTitle, InlineMessage } from "@/components/ui";
import { HOME_BY_ROLE } from "@/lib/auth/constants";
import { requireUser } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Cambiar contraseña" };

export default function CambiarPasswordPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CambiarPassword />
    </Suspense>
  );
}

async function CambiarPassword() {
  const user = await requireUser({ allowPendingPasswordChange: true });

  return (
    <div className="flex w-full flex-col gap-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Cambiar contraseña</CardTitle>
          <CardDescription>{user.nombre}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {user.debeCambiarPassword && (
            <InlineMessage tone="info">Por seguridad, tenés que cambiar tu contraseña antes de seguir.</InlineMessage>
          )}
          <PasswordForm />
        </CardContent>
      </Card>
      <div className="flex items-center justify-between gap-2">
        {user.debeCambiarPassword ? (
          <span />
        ) : (
          <Link href={HOME_BY_ROLE[user.rol]} className={buttonClasses("ghost", "sm")}>
            Volver
          </Link>
        )}
        <form action="/api/auth/logout" method="post">
          <button type="submit" className={buttonClasses("ghost", "sm")}>
            <LogOut aria-hidden="true" className="size-4" />
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}
