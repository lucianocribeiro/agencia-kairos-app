import type { Metadata } from "next";
import Link from "next/link";

import { MAESTROS } from "@/components/shell/nav-config";

export const metadata: Metadata = { title: "Maestros" };

export default function MaestrosPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Maestros</h1>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MAESTROS.map(({ href, label, icon: Icon }) => (
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
  );
}
