"use client";

import { Building2, Heart, Home, LogOut, Mail, User } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/(auth)/actions";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/inicio", labelKey: "sidebar.inicio", icon: Home },
  { href: "/propiedades", labelKey: "sidebar.propiedades", icon: Building2 },
  { href: "/favoritos", labelKey: "sidebar.favoritos", icon: Heart },
  { href: "/perfil", labelKey: "sidebar.perfil", icon: User },
  { href: "/mensajes", labelKey: "sidebar.mensajes", icon: Mail },
] as const;

export function ClientSidebar({
  user,
}: {
  user: { name: string; roleKey: string };
}) {
  const t = useT();
  const pathname = usePathname();
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside className="fixed left-0 top-0 z-20 flex h-screen w-[260px] flex-col bg-ink text-cream-50">
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

      <nav className="mt-10 flex-1 px-3">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                    active
                      ? "bg-cream-50/8 text-gold"
                      : "text-cream-50/70 hover:bg-cream-50/5 hover:text-cream-50",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={17} strokeWidth={1.75} />
                  <span>{t(labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="m-3 rounded-xl border border-cream-50/10 p-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream-50/10 font-serif text-[11px] font-medium text-cream-50">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight">
              {user.name}
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
  );
}

