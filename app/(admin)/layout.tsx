import { AppShell } from "@/components/shell/app-shell";

// TODO(CC-F1-02): el rol va a salir de la sesión. Por ahora es fijo para la vista previa.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AppShell role="Admin">{children}</AppShell>;
}
