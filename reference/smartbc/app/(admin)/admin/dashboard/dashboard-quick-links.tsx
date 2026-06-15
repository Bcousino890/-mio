"use client";

import { ArrowRight, Calendar, ClipboardList, User, Users } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin/particulares", labelKey: "admin.nav.particulares", icon: User },
  { href: "/admin/clientes", labelKey: "admin.nav.clientes", icon: Users },
  { href: "/admin/solicitudes", labelKey: "admin.nav.solicitudes", icon: ClipboardList },
  { href: "/admin/calendario", labelKey: "admin.nav.calendario", icon: Calendar },
] as const;

export function DashboardQuickLinks({ className }: { className?: string }) {
  const t = useT();
  return (
    <Card
      as="section"
      className={cn("border-gold/20 bg-white/70 p-5 backdrop-blur", className)}
    >
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
        {t("dashboard.quickLinks.title")}
      </h2>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {LINKS.map(({ href, labelKey, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-xl border border-gold/20 bg-white/70 px-4 py-3 shadow-[0_10px_30px_-24px_rgba(40,28,10,0.25)] transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              {t(labelKey)}
            </span>
            <ArrowRight
              size={14}
              strokeWidth={1.75}
              className="shrink-0 text-ink/30"
            />
          </Link>
        ))}
      </div>
    </Card>
  );
}
