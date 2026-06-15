"use client";

import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/** Small trend footer for the "new listings" StatCard. */
export function DashboardTrend({ trend }: { trend: number }) {
  const t = useT();
  if (trend === 0) return null;
  return (
    <p
      className={cn(
        "text-[11px]",
        trend > 0 ? "text-emerald-600" : "text-red-600",
      )}
    >
      {trend > 0 ? "↑" : "↓"}{" "}
      {t("dashboard.stats.trendVsLastWeek", { n: Math.abs(trend) })}
    </p>
  );
}
