/** Pantallas sin sidebar (login, cambiar contraseña), con los mismos tokens. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="flex w-full max-w-sm flex-col items-center">
        {children}
      </div>
    </main>
  );
}
