"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { Role } from "@/lib/roles";
import { HOME_BY_ROLE, isActivePath, isNavGroup, NAV_BY_ROLE, type NavGroup, type NavLink } from "./nav-config";
import { Logo } from "./logo";

interface SidebarNavProps {
  role: Role;
  pathname: string;
  collapsed: boolean;
  /** Botón del header: contraer/expandir (desktop) o cerrar (mobile). */
  headerAction: ReactNode;
  /** Se llama al navegar (el drawer mobile se cierra). */
  onNavigate?: () => void;
  /** Expande el sidebar (al abrir un submenú estando colapsado). */
  onExpand?: () => void;
  navId?: string;
}

const itemBase =
  "group relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors";
const itemIdle = "text-muted hover:bg-card hover:text-text";
const itemActive = "bg-card text-accent";

function ActiveBar() {
  return <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />;
}

function Label({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return <span className={collapsed ? "sr-only" : "truncate"}>{children}</span>;
}

function SidebarLink({
  item,
  pathname,
  collapsed,
  onNavigate,
  nested = false,
}: {
  item: NavLink;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  const active = isActivePath(pathname, item.href, item.exact);
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          itemBase,
          active ? itemActive : itemIdle,
          collapsed && "justify-center px-0",
          nested && "h-9 text-[13px]",
        )}
      >
        {active && <ActiveBar />}
        <Icon aria-hidden="true" className={cn("shrink-0", nested ? "size-4" : "size-5")} />
        <Label collapsed={collapsed}>{item.label}</Label>
      </Link>
    </li>
  );
}

function SidebarGroup({
  item,
  pathname,
  collapsed,
  onNavigate,
  onExpand,
}: {
  item: NavGroup;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
  onExpand?: () => void;
}) {
  const active = isActivePath(pathname, item.href);
  const [open, setOpen] = useState(active);
  const [lastPathname, setLastPathname] = useState(pathname);
  const listId = useId();
  const Icon = item.icon;

  // Al navegar hacia una ruta del grupo, se abre (ajuste de estado en render, sin efecto).
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (active && !open) setOpen(true);
  }

  const expanded = open && !collapsed;

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (collapsed) {
            onExpand?.();
            setOpen(true);
          } else {
            setOpen(!open);
          }
        }}
        aria-expanded={expanded}
        aria-controls={listId}
        title={collapsed ? item.label : undefined}
        className={cn(
          itemBase,
          "w-full",
          active && !expanded ? itemActive : itemIdle,
          active && expanded && "text-text",
          collapsed && "justify-center px-0",
        )}
      >
        {active && !expanded && <ActiveBar />}
        <Icon aria-hidden="true" className="size-5 shrink-0" />
        <Label collapsed={collapsed}>{item.label}</Label>
        {!collapsed && (
          <ChevronDown
            aria-hidden="true"
            className={cn("ml-auto size-4 shrink-0 transition-transform", expanded && "rotate-180")}
          />
        )}
      </button>
      <ul id={listId} hidden={!expanded} className="mt-1 flex flex-col gap-0.5 border-l border-line pl-2 ml-5">
        {item.children.map((child) => (
          <SidebarLink key={child.href} item={child} pathname={pathname} collapsed={false} onNavigate={onNavigate} nested />
        ))}
      </ul>
    </li>
  );
}

export function SidebarNav({ role, pathname, collapsed, headerAction, onNavigate, onExpand, navId }: SidebarNavProps) {
  const items = NAV_BY_ROLE[role];

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex shrink-0 border-b border-line",
          collapsed ? "flex-col items-center gap-2 px-2 py-3" : "items-center justify-between gap-2 px-3 py-3",
        )}
      >
        <Link href={HOME_BY_ROLE[role]} onClick={onNavigate} aria-label="Ir al inicio" className="rounded-md">
          <Logo compact={collapsed} eager />
        </Link>
        {headerAction}
      </div>

      <nav id={navId} aria-label="Menú principal" className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-1">
          {items.map((item) =>
            isNavGroup(item) ? (
              <SidebarGroup
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                onNavigate={onNavigate}
                onExpand={onExpand}
              />
            ) : (
              <SidebarLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
            ),
          )}
        </ul>
      </nav>
    </div>
  );
}
