"use client";

import { Clock, Home, Inbox, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useLanguage } from "@/lib/i18n/provider";
import type { Lang } from "@/lib/i18n/dictionary";
import { cn } from "@/lib/utils";

export type ActivityItem =
  | { type: "particular"; timestamp: string; portal: string; externalId: string }
  | { type: "visit"; timestamp: string; status: string }
  | { type: "client"; timestamp: string; name: string | null };

const DATE_LOCALES: Record<Lang, string> = {
  es: "es-ES",
  en: "en-GB",
  fr: "fr-FR",
  de: "de-DE",
};

const TYPE_STYLES: Record<
  ActivityItem["type"],
  {
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    iconClass: string;
    chipClass: string;
    badgeKey: string;
  }
> = {
  particular: {
    icon: Home,
    iconClass: "bg-gold/15 text-gold",
    chipClass: "border-gold/30 bg-gold/10 text-gold-dark",
    badgeKey: "dashboard.activity.badge.listing",
  },
  visit: {
    icon: Clock,
    iconClass: "bg-blue-50 text-blue-600",
    chipClass: "border-blue-200 bg-blue-50 text-blue-700",
    badgeKey: "dashboard.activity.badge.visit",
  },
  client: {
    icon: Users,
    iconClass: "bg-emerald-50 text-emerald-600",
    chipClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    badgeKey: "dashboard.activity.badge.client",
  },
};

const KNOWN_VISIT_STATUSES = ["pending", "confirmed", "completed", "cancelled"];

export function DashboardActivity({
  activity,
  className,
}: {
  activity: ActivityItem[];
  className?: string;
}) {
  const { lang, t } = useLanguage();

  const getTimeAgo = (timestamp: string) => {
    const date = new Date(timestamp);
    const diff = Date.now() - date.getTime();

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return t("admin.relativeTime.justNow");
    if (minutes < 60) return t("admin.relativeTime.minutesAgo", { n: minutes });
    if (hours < 24) return t("admin.relativeTime.hoursAgo", { n: hours });
    if (days < 7) return t("admin.relativeTime.daysAgo", { n: days });
    return date.toLocaleDateString(DATE_LOCALES[lang]);
  };

  const getDescription = (item: ActivityItem) => {
    switch (item.type) {
      case "particular":
        return t("dashboard.activity.item.newListing", {
          portal: item.portal,
          id: item.externalId,
        });
      case "visit":
        return t("dashboard.activity.item.visitRequest", {
          status: KNOWN_VISIT_STATUSES.includes(item.status)
            ? t(`clientes.ficha.visits.status.${item.status}`)
            : item.status,
        });
      case "client":
        return t("dashboard.activity.item.newClient", {
          name: item.name || t("dashboard.activity.noName"),
        });
    }
  };

  return (
    <Card
      as="section"
      className={cn(
        "overflow-hidden border-gold/20 bg-white/70 backdrop-blur",
        className,
      )}
    >
      <h2 className="px-5 pt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
        {t("dashboard.activity.title")}
      </h2>

      {activity.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/10 text-gold">
            <Inbox size={20} strokeWidth={1.5} />
          </span>
          <p className="mt-3 text-sm text-ink/50">
            {t("dashboard.activity.empty")}
          </p>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-gold/10 border-t border-gold/10">
          {activity.map((item, idx) => {
            const styles = TYPE_STYLES[item.type];
            const Icon = styles.icon;
            return (
              <div
                key={idx}
                className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-cream-50/60"
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    styles.iconClass,
                  )}
                >
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">
                    {getDescription(item)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink/50">
                    {getTimeAgo(item.timestamp)}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                    styles.chipClass,
                  )}
                >
                  {t(styles.badgeKey)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
