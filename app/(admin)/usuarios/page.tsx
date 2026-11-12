import type { Metadata } from "next";

import { Guarded } from "@/components/auth/guarded";
import { UsuariosPage } from "@/components/abm/server/usuarios-page";

export const metadata: Metadata = { title: "Usuarios" };

export default function Page() {
  return (
    <Guarded admin>
      <UsuariosPage />
    </Guarded>
  );
}
