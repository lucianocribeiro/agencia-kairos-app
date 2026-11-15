import type { Metadata } from "next";
import Link from "next/link";

import { Guarded } from "@/components/auth/guarded";
import { REPORTES_NAV } from "@/components/shell/nav-config";

export const metadata: Metadata = { title: "Reportes" };

/** Índice de reportes (solo Admin). */
export default function ReportesPage() {
  return (
    <Guarded admin>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Reportes</h1>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {REPORTES_NAV.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex items-center gap-3 rounded-lg border border-line bg-card px-4 py-4 text-sm font-medium text-text transition-colors hover:border-muted hover:text-white"
              >
                <Icon aria-hidden="true" className="size-5 text-muted" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Guarded>
  );
}
