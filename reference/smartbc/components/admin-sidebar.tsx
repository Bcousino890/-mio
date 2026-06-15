"use client";

import {
  BarChart3,
  Building2,
  Calendar,
  ClipboardList,
  Heart,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Radio,
  Send,
  Settings,
  Sparkles,
  Stethoscope,
  User,
  UserCog,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { useT } from "@/lib/i18n/provider";
import {
  canAccess,
  type EffectivePermissions,
  type PermissionResource,
} from "@/lib/permissions";
import type { AdminUser } from "@/lib/types";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  /** Recurso de permisos asociado. Si se define, se comprueba canAccess(role, resource, "view") */
  permissionResource?: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/admin",               labelKey: "admin.nav.dashboard",     icon: LayoutDashboard },
  { href: "/admin/agencias",      labelKey: "admin.nav.agencias",      icon: Building2,    permissionResource: "properties"    },
  { href: "/admin/propiedades",   labelKey: "admin.nav.propiedades",   icon: Home,         permissionResource: "properties"    },
  { href: "/admin/particulares",  labelKey: "admin.nav.particulares",  icon: User,         permissionResource: "particulares"  },
  { href: "/admin/publicacion",   labelKey: "admin.nav.publicacion",   icon: Send,         permissionResource: "properties"    },
  { href: "/admin/idealista",     labelKey: "admin.nav.idealista",     icon: Sparkles,     permissionResource: "properties"    },
  { href: "/admin/clientes",      labelKey: "admin.nav.clientes",      icon: Users,        permissionResource: "clientes"      },
  { href: "/admin/solicitudes",   labelKey: "admin.nav.solicitudes",   icon: ClipboardList, permissionResource: "solicitudes"  },
  { href: "/admin/calendario",    labelKey: "admin.nav.calendario",    icon: Calendar,     permissionResource: "calendario"    },
  { href: "/admin/mensajes",      labelKey: "admin.nav.mensajes",      icon: MessageSquare, permissionResource: "mensajes"     },
  { href: "/admin/sindicacion",   labelKey: "admin.nav.sindicacion",   icon: Radio,        permissionResource: "properties"    },
  { href: "/admin/reportes",      labelKey: "admin.nav.reportes",      icon: BarChart3,    permissionResource: "reportes"      },
  { href: "/admin/usuarios",      labelKey: "admin.nav.usuarios",      icon: UserCog,      permissionResource: "usuarios"      },
  { href: "/admin/diagnostico",   labelKey: "admin.nav.diagnostico",   icon: Stethoscope,  permissionResource: "configuracion" },
  { href: "/admin/configuracion", labelKey: "admin.nav.configuracion", icon: Settings,     permissionResource: "configuracion" },
];

interface AdminSidebarProps {
  user: AdminUser;
  /** Rol del usuario actual. Usado para filtrar items según permisos. */
  currentRole?: string;
  /**
   * Permisos efectivos (rol + excepciones por usuario) calculados en el
   * servidor. Si vienen, mandan sobre canAccess(rol).
   */
  permissions?: EffectivePermissions;
  /** Cantidad de visitas pendientes para el badge de Calendario. */
  pendingVisits?: number;
  /** Mensajes directos no leídos para el badge de Mensajes. */
  unreadMessages?: number;
  /** Callback para notificar al padre cuando el sidebar abre/cierra (mobile). */
  onOpenChange?: (open: boolean) => void;
}

export function AdminSidebar({ user, currentRole, permissions, pendingVisits = 0, unreadMessages = 0, onOpenChange }: AdminSidebarProps) {
  const t = useT();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleMobile() {
    const next = !mobileOpen;
    setMobileOpen(next);
    onOpenChange?.(next);
  }

  function closeMobile() {
    setMobileOpen(false);
    onOpenChange?.(false);
  }

  // Filtrar items de nav según permisos. Si llegan los permisos efectivos
  // (rol + excepciones por usuario) usamos esos; si no, defaults del rol.
  const visibleItems = NAV_ITEMS.filter(({ permissionResource }) => {
    if (!permissionResource) return true;
    if (permissions) {
      return permissions[permissionResource as PermissionResource]?.view ?? true;
    }
    if (!currentRole) return true;
    return canAccess(currentRole, permissionResource, "view");
  });

  return (
    <>
      {/* Botón hamburger — solo visible en mobile */}
      <button
        type="button"
        onClick={toggleMobile}
        aria-label="Abrir menú"
        className="fixed left-4 top-4 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-ink text-cream-50 shadow-md lg:hidden"
      >
        {mobileOpen ? <X size={18} strokeWidth={2} /> : <Menu size={18} strokeWidth={2} />}
      </button>

      {/* Overlay oscuro — solo en mobile cuando está abierto */}
      {mobileOpen && (
        <div
          aria-hidden="true"
          onClick={closeMobile}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-30 flex h-screen w-[260px] flex-col bg-ink text-cream-50 transition-transform duration-300",
          // Mobile: oculto por defecto, visible cuando mobileOpen
          "-translate-x-full lg:translate-x-0",
          mobileOpen && "translate-x-0",
        )}
      >
        {/* Logo (white via CSS filter trick: brightness 0 turns the dark navy
            PNG to pure black, invert flips it to white) */}
        <div className="flex flex-col items-center px-6 pt-7">
          <Image
            src="/logo.png"
            alt="Benjamín Cousiño Propiedades"
            width={420}
            height={Math.round(420 * (519 / 3282))}
            priority
            className="h-auto w-full select-none"
            style={{ filter: "brightness(0) invert(1)" }}
          />
        </div>

        <p className="mt-7 px-6 text-[10px] font-semibold tracking-[0.18em] text-gold/85">
          {t("admin.section.label")}
        </p>

        <nav className="mt-3 flex-1 overflow-y-auto px-3">
          <ul className="space-y-1">
            {visibleItems.map(({ href, labelKey, icon: Icon }) => {
              // Para la ruta exacta "/admin" (dashboard) solo se activa con match exacto
              const active =
                pathname === href ||
                (href !== "/admin" && pathname.startsWith(`${href}/`));
              const isCalendario = href === "/admin/calendario";
              const isMensajes = href === "/admin/mensajes";
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={closeMobile}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                      active
                        ? "bg-cream-50/8 text-gold"
                        : "text-cream-50/70 hover:bg-cream-50/5 hover:text-cream-50",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={17} strokeWidth={1.75} />
                    <span className="flex-1">{t(labelKey)}</span>
                    {isCalendario && pendingVisits > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gold/90 px-1 text-[10px] font-semibold text-ink">
                        {pendingVisits}
                      </span>
                    )}
                    {isMensajes && unreadMessages > 0 && (
                      <span className="ml-auto rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white min-w-[18px] text-center">
                        {unreadMessages > 99 ? "99+" : unreadMessages}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="m-3 rounded-xl border border-cream-50/10 p-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream-50/10 font-serif text-[11px] font-medium text-cream-50">
              {user.initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold leading-tight">
                {user.firstName} {user.lastName}
              </p>
              <p className="mt-0.5 truncate text-[10px] text-cream-50/55">
                {t(user.roleKey)}
              </p>
            </div>
          </div>
          <form action={signOutAction} className="mt-3">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-cream-50/15 py-2 text-[11px] text-cream-50/70 transition hover:bg-cream-50/5 hover:text-cream-50"
            >
              <LogOut size={13} strokeWidth={1.75} />
              <span>{t("sidebar.logout")}</span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
