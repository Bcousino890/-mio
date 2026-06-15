"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Unified stat card used across both client and admin dashboards.
 *
 * Variants supported via slots:
 *  - icon on the LEFT (default) or icon as RIGHT slot via `rightSlot`
 *  - dark "ink" icon background (`iconStyle="ink"`) vs gold (default)
 *  - optional CTA link below (used in cliente dashboard)
 *  - optional `rightSlot` for donuts, illustrations, etc.
 */
export type StatCardProps = {
  icon?: React.ReactNode;
  iconStyle?: "gold" | "ink";
  /** i18n key for the small uppercase label */
  labelKey: string;
  value: string | number;
  /** i18n key for the small help text below the value */
  helpKey?: string;
  /** Optional CTA link rendered at the bottom */
  action?: { href: string; labelKey: string };
  /** Optional element rendered on the right (donut, alt icon, ...) */
  rightSlot?: React.ReactNode;
  /** Optional extra node rendered under the value/help (e.g. a price threshold) */
  footer?: React.ReactNode;
  className?: string;
};

export function StatCard({
  icon,
  iconStyle = "gold",
  labelKey,
  value,
  helpKey,
  action,
  rightSlot,
  footer,
  className,
}: StatCardProps) {
  const t = useT();
  return (
    <Card
      as="article"
      className={cn(
        "p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)]",
        className,
      )}
    >
      <div className="flex items-center gap-4">
        {icon && (
          <span
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
              iconStyle === "ink"
                ? "rounded-xl bg-ink text-cream-50"
                : "bg-gold/15 text-gold",
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
            {t(labelKey)}
          </p>
          <p className="mt-0.5 font-serif text-3xl font-medium leading-none text-ink">
            {value}
          </p>
          {helpKey && (
            <p className="mt-1 text-[11px] text-ink/55">{t(helpKey)}</p>
          )}
        </div>
        {rightSlot}
      </div>

      {footer && <div className="mt-3">{footer}</div>}

      {action && (
        <Link
          href={action.href}
          className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-gold-dark transition hover:text-gold"
        >
          <span>{t(action.labelKey)}</span>
          <ArrowRight size={13} strokeWidth={1.75} />
        </Link>
      )}
    </Card>
  );
}
