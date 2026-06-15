"use client";

import { Activity, AlertTriangle, CheckCircle2, Radio } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";

type Stats = {
  totalFeeds: number;
  activeFeeds: number;
  healthyFeeds: number;
  feedsWithErrors: number;
  syncedPropertiesLast24h: number;
};

export function FeedsStatsBlock({ stats }: { stats: Stats }) {
  return (
    <Card className="p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.25)] md:p-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Radio size={20} strokeWidth={1.75} />}
          iconStyle="ink"
          labelKey="sindicacion.stats.activeFeeds"
          helpKey="sindicacion.stats.activeFeeds.help"
          value={`${stats.activeFeeds} / ${stats.totalFeeds}`}
          className="border-0 bg-transparent p-0 shadow-none"
        />
        <StatCard
          icon={<CheckCircle2 size={20} strokeWidth={1.75} />}
          labelKey="sindicacion.stats.healthy"
          helpKey="sindicacion.stats.healthy.help"
          value={stats.healthyFeeds}
          className="border-0 bg-transparent p-0 shadow-none"
        />
        <StatCard
          icon={<AlertTriangle size={20} strokeWidth={1.75} />}
          labelKey="sindicacion.stats.errors"
          helpKey="sindicacion.stats.errors.help"
          value={stats.feedsWithErrors}
          className="border-0 bg-transparent p-0 shadow-none"
        />
        <StatCard
          icon={<Activity size={20} strokeWidth={1.75} />}
          labelKey="sindicacion.stats.synced24h"
          helpKey="sindicacion.stats.synced24h.help"
          value={stats.syncedPropertiesLast24h}
          className="border-0 bg-transparent p-0 shadow-none"
        />
      </div>
    </Card>
  );
}
