"use client";

import { DashboardStatsBlock } from "@/components/dashboard/dashboard-stats";
import { RecentMessagesBlock } from "@/components/dashboard/recent-messages";
import { RecommendationCard } from "@/components/dashboard/recommendation-card";
import { RecommendedPropertiesBlock } from "@/components/dashboard/recommended-properties";
import { UpcomingVisitsBlock } from "@/components/dashboard/upcoming-visits";
import { SectionHeader } from "@/components/section-header";
import { PageFooter } from "@/components/ui/page-footer";
import {
  mockClient,
  mockMessages,
  mockRecommendation,
  mockRecommendedProperties,
  mockStats,
  mockVisits,
} from "@/lib/mock-dashboard";

export default function InicioPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-10 md:px-8">
      <SectionHeader
        titleKey="inicio.title"
        titleVars={{ name: mockClient.firstName }}
        subtitleKey="inicio.subtitle"
      />

      {/* Stats row */}
      <div className="mt-8">
        <DashboardStatsBlock stats={mockStats} />
      </div>

      {/* Three columns: visits | messages | recommendation */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <UpcomingVisitsBlock visits={mockVisits} />
        <RecentMessagesBlock messages={mockMessages} />
        <RecommendationCard property={mockRecommendation} />
      </div>

      {/* Recommended properties grid */}
      <div className="mt-5">
        <RecommendedPropertiesBlock properties={mockRecommendedProperties} />
      </div>

      <PageFooter textKey="login.footer" />
    </div>
  );
}
