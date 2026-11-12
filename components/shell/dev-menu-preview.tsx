import Link from "next/link";

import { ROLES } from "@/lib/roles";
import { HOME_BY_ROLE, isNavGroup, NAV_BY_ROLE } from "./nav-config";

/**
 * Vista previa temporal de los menús de ambos roles.
 * TODO(CC-F1-02): eliminar cuando llegue el login.
 */
export function DevMenuPreview() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-widest text-accent">Vista previa · solo desarrollo</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Menús por rol</h1>
        <p className="text-sm text-muted">
          Todavía no hay login. Elegí un rol para recorrer su menú. Esta pantalla se elimina en CC-F1-02.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {ROLES.map((role) => (
          <section key={role} className="flex flex-col gap-4 rounded-lg border border-line bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">{role}</h2>
              <Link
                href={HOME_BY_ROLE[role]}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:brightness-110"
              >
                Entrar como {role}
              </Link>
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              {NAV_BY_ROLE[role].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="flex items-center gap-2 rounded px-1 py-1 text-text hover:text-white">
                    <item.icon aria-hidden="true" className="size-4 text-muted" />
                    {item.label}
                  </Link>
                  {isNavGroup(item) && (
                    <ul className="mt-1 ml-6 flex flex-col gap-0.5 border-l border-line pl-3">
                      {item.children.map((child) => (
                        <li key={child.href}>
                          <Link href={child.href} className="block rounded px-1 py-0.5 text-muted hover:text-text">
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
