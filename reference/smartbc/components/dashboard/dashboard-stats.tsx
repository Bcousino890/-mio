"use client";

import { Bell, Calendar, FolderOpen, Heart } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import type { DashboardStats } from "@/lib/types";

export function DashboardStatsBlock({ stats }: { stats: DashboardStats }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatCard
        icon={<Calendar size={20} strokeWidth={1.75} />}
        labelKey="inicio.stats.upcomingVisits"
        value={stats.upcomingVisits}
        action={{ href: "/inicio", labelKey: "inicio.stats.upcomingVisits.action" }}
      />
      <StatCard
        icon={<Heart size={20} strokeWidth={1.75} />}
        labelKey="inicio.stats.favorites"
        value={stats.favoriteProperties}
        action={{ href: "/favoritos", labelKey: "inicio.stats.favorites.action" }}
      />
      <StatCard
        icon={<Bell size={20} strokeWidth={1.75} />}
        labelKey="inicio.stats.unreadMessages"
        value={stats.unreadMessages}
        action={{ href: "/mensajes", labelKey: "inicio.stats.unreadMessages.action" }}
      />
      <StatCard
        icon={<FolderOpen size={20} strokeWidth={1.75} />}
        labelKey="inicio.stats.documents"
        value={stats.documents}
        action={{ href: "/perfil", labelKey: "inicio.stats.documents.action" }}
      />
    </div>
  );
}
