import type { Metadata } from "next";
import { Sora } from "next/font/google";

import { ThemeSync } from "@/components/shell/theme-toggle";
import { ToastProvider } from "@/components/ui/toast";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Kairos", template: "%s · Kairos" },
  description: "App interna de Agencia Kairos",
  robots: { index: false, follow: false },
};

/**
 * Modo claro/oscuro (CC-F4-09): el script inline del <head> pone la clase `light` en <html>
 * antes de la primera pintura si está guardada (localStorage). El layout sigue siendo estático
 * (no lee cookies ni headers), compatible con cacheComponents; proxy.ts no participa.
 * `suppressHydrationWarning`: la clase de <html> la puede cambiar el script antes de hidratar.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${sora.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-bg font-sans text-text">
        <ThemeSync />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
