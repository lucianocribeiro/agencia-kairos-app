import {
  ArrowLeftRight,
  Briefcase,
  Building2,
  Clock,
  Database,
  FileDown,
  FileText,
  FolderKanban,
  Handshake,
  Landmark,
  Receipt,
  LayoutDashboard,
  ShoppingCart,
  SlidersHorizontal,
  Tags,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/lib/roles";

export interface NavLink {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup extends NavLink {
  children: readonly NavLink[];
}

export type NavItem = NavLink | NavGroup;

export function isNavGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

export const MAESTROS: readonly NavLink[] = [
  { label: "Clientes", href: "/maestros/clientes", icon: Building2 },
  { label: "Proveedores", href: "/maestros/proveedores", icon: Truck },
  { label: "Proyectos", href: "/maestros/proyectos", icon: FolderKanban },
  { label: "Socios", href: "/maestros/socios", icon: Handshake },
  { label: "Cuentas", href: "/maestros/cuentas", icon: Landmark },
  { label: "Categorías", href: "/maestros/categorias", icon: Tags },
  { label: "Unidades de negocio", href: "/maestros/unidades-de-negocio", icon: Briefcase },
  { label: "Tipos de operación", href: "/maestros/tipos-de-operacion", icon: ArrowLeftRight },
  { label: "Tipos de comprobante", href: "/maestros/tipos-de-comprobante", icon: FileText },
  { label: "Parámetros", href: "/maestros/parametros", icon: SlidersHorizontal },
];

export const NAV_BY_ROLE: Record<Role, readonly NavItem[]> = {
  Admin: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Horas", href: "/horas", icon: Clock },
    { label: "Ventas", href: "/ventas", icon: Receipt, children: [{ label: "Importar", href: "/ventas/importar", icon: FileDown }] },
    { label: "Compras", href: "/compras", icon: ShoppingCart, children: [{ label: "Importar", href: "/compras/importar", icon: FileDown }] },
    { label: "Usuarios", href: "/usuarios", icon: Users },
    { label: "Maestros", href: "/maestros", icon: Database, children: MAESTROS },
  ],
  Empleado: [{ label: "Mis horas", href: "/mis-horas", icon: Clock }],
};

export { HOME_BY_ROLE } from "@/lib/roles";

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
