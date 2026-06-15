"use client";

import { Building2, Home, Tag, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";

type Stats = {
  totalAgencies: number;
  totalRent: number;
  totalSale: number;
  totalProperties: number;
};

export function AgenciesStatsBlock({ stats }: { stats: Stats }) {
  return (
    <Card className="p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.25)] md:p-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Building2 size={22} strokeWidth={1.75} />}
          iconStyle="ink"
          labelKey="agencias.stats.totalAgencies"
          helpKey="agencias.stats.totalAgencies.help"
          value={stats.totalAgencies}
          className="border-0 bg-transparent p-0 shadow-none"
        />
        <StatCard
          icon={<Home size={20} strokeWidth={1.75} />}
          labelKey="agencias.stats.rent"
          helpKey="agencias.stats.realtime"
          value={stats.totalRent}
          className="border-0 bg-transparent p-0 shadow-none"
        />
        <StatCard
          icon={<Tag size={19} strokeWidth={1.75} />}
          labelKey="agencias.stats.sale"
          helpKey="agencias.stats.realtime"
          value={stats.totalSale}
          className="border-0 bg-transparent p-0 shadow-none"
        />
        <StatCard
          icon={<TrendingUp size={20} strokeWidth={1.75} />}
          labelKey="agencias.stats.total"
          helpKey="agencias.stats.total.help"
          value={stats.totalProperties}
          className="border-0 bg-transparent p-0 shadow-none"
        />
      </div>
    </Card>
  );
}
