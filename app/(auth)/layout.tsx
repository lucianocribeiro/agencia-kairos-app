import { ThemeToggle } from "@/components/shell/theme-toggle";

/** Pantallas sin sidebar (login, cambiar contraseña), con los mismos tokens y el botón de modo claro/oscuro. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>
      <div className="flex w-full max-w-sm flex-col items-center">
        {children}
      </div>
    </main>
  );
}
