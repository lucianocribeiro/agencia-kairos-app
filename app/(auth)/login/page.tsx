import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { getOptionalUser } from "@/lib/auth/guards";
import { homeFor } from "@/lib/auth/login";

export const metadata: Metadata = { title: "Ingresar" };

export default function LoginPage() {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Ingresá a Kairos</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<LoginForm />}>
          <RedirectIfLoggedIn />
        </Suspense>
      </CardContent>
    </Card>
  );
}

/** Si ya hay una sesión válida, va directo al inicio. */
async function RedirectIfLoggedIn() {
  const user = await getOptionalUser();
  if (user) redirect(homeFor(user));
  return <LoginForm />;
}
