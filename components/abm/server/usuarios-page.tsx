import "server-only";

import { UsuariosManager } from "@/components/abm/usuarios-manager";
import { loadUsuarios } from "@/lib/abm/server/usuarios-service";
import { requireAdmin } from "@/lib/auth/guards";

export async function UsuariosPage() {
  const user = await requireAdmin();
  const data = await loadUsuarios();
  return <UsuariosManager data={data} currentUserId={user.id} />;
}
