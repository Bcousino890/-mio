"use client";

import { Calendar, Filter, Star, UserCheck, Users } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import type { ClientsStats } from "@/lib/types";

export function ClientsStatsBlock({ stats }: { stats: ClientsStats }) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard
        icon={<Users size={20} strokeWidth={1.75} />}
        labelKey="clientes.stats.total"
        helpKey="clientes.stats.total.help"
        value={stats.totalClients}
      />
      <StatCard
        icon={<UserCheck size={20} strokeWidth={1.75} />}
        labelKey="clientes.stats.activeToday"
        helpKey="clientes.stats.activeToday.help"
        value={stats.activeToday}
      />
      <StatCard
        icon={<Calendar size={20} strokeWidth={1.75} />}
        labelKey="clientes.stats.visits"
        helpKey="clientes.stats.visits.help"
        value={stats.visitsRequested}
      />
      <StatCard
        icon={<Filter size={19} strokeWidth={1.75} />}
        labelKey="clientes.stats.customFilters"
        helpKey="clientes.stats.customFilters.help"
        value={stats.customFilters}
      />
      <StatCard
        icon={<Star size={19} strokeWidth={1.75} />}
        labelKey="clientes.stats.priority"
        helpKey="clientes.stats.priority.help"
        value={stats.priorityFollowUp}
      />
    </section>
  );
}
