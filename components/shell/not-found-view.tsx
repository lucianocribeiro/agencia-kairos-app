import Link from "next/link";
import { Suspense } from "react";

import { buttonClasses, Card, CardContent } from "@/components/ui";
import { LOGIN_PATH } from "@/lib/auth/constants";
import { getOptionalUser } from "@/lib/auth/guards";
import { HOME_BY_ROLE } from "@/lib/roles";
import { AppShell } from "./app-shell";
import { Logo } from "./logo";

export const NOT_FOUND_TEXT = "No encontramos esta página.";

/** Tarjeta neutra (sin estilo de error). No muestra la URL pedida ni ningún otro dato. */
function NotFoundCard({ home }: { home: string }) {
  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex flex-col items-start gap-4 pt-6">
        <p className="text-base text-text">{NOT_FOUND_TEXT}</p>
        <Link href={home} className={buttonClasses("primary", "md")}>
          Volver al inicio
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Página «no encontrada» de toda la app (app/not-found.tsx). Con sesión: dentro del shell
 * del rol, y «Volver al inicio» lleva al inicio del rol. Sin sesión: centrada con el logo,
 * y el botón va a /login.
 */
export async function NotFoundContent() {
  const user = await getOptionalUser();
  if (!user) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg px-4 py-10">
        <Logo eager />
        <NotFoundCard home={LOGIN_PATH} />
      </main>
    );
  }
  return (
    <AppShell user={{ nombre: user.nombre, rol: user.rol }}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <NotFoundCard home={HOME_BY_ROLE[user.rol]} />
      </div>
    </AppShell>
  );
}

export function NotFoundPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-bg" />}>
      <NotFoundContent />
    </Suspense>
  );
}
