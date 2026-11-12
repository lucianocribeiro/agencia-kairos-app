import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LOGIN_PATH } from "@/lib/auth/constants";
import { getOptionalUser } from "@/lib/auth/guards";
import { homeFor } from "@/lib/auth/login";

/** `/` redirige según el rol de la sesión, o a /login. */
export default function Home() {
  return (
    <Suspense>
      <RedirectByRole />
    </Suspense>
  );
}

async function RedirectByRole(): Promise<never> {
  const user = await getOptionalUser();
  redirect(user ? homeFor(user) : LOGIN_PATH);
}
