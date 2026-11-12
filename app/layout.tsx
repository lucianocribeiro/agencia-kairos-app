import type { Metadata } from "next";
import { Sora } from "next/font/google";

import { ToastProvider } from "@/components/ui/toast";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${sora.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg font-sans text-text">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
