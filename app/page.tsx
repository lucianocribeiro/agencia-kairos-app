import { DevMenuPreview } from "@/components/shell/dev-menu-preview";

// TODO(CC-F1-02): reemplazar por el login / redirect según la sesión.
// La vista previa de menús se muestra en desarrollo y en deploys de preview de Vercel, nunca en producción.
const showPreview = process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV === "preview";

export default function Home() {
  if (showPreview) return <DevMenuPreview />;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-2xl font-semibold tracking-tight text-white">Kairos</p>
      <p className="text-sm text-muted">En construcción</p>
    </main>
  );
}
