"use client";

import { ArrowLeft, Bell } from "lucide-react";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { AgencyConditionsBlock } from "@/components/admin/agency-detail/agency-conditions-block";
import { AgencyContactCard } from "@/components/admin/agency-detail/agency-contact-card";
import { AgencyIdentityCard } from "@/components/admin/agency-detail/agency-identity-card";
import { AgencyPropertiesTable } from "@/components/admin/agency-detail/agency-properties-table";
import { AgencyStatsGrid } from "@/components/admin/agency-detail/agency-stats-grid";
import { PageFooter } from "@/components/ui/page-footer";
import { useT } from "@/lib/i18n/provider";
import type { AgencyDetail } from "@/lib/types";

export function AgencyDetailView({ agency }: { agency: AgencyDetail }) {
  const t = useT();

  return (
    <div className="mx-auto flex min-h-screen max-w-[1200px] flex-col px-6 pb-10 lg:px-10">
      {/* Top bar: back link + bell + language */}
      <div className="flex items-center justify-between gap-4 pt-7 md:pt-9">
        <Link
          href="/admin/agencias"
          className="inline-flex items-center gap-2 text-sm text-ink/65 transition hover:text-ink"
        >
          <ArrowLeft size={15} strokeWidth={1.75} className="text-gold" />
          <span>{t("agency.back")}</span>
        </Link>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={t("admin.notifications")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-ink/10 bg-white/70 text-ink/65 transition hover:border-gold/40 hover:text-ink"
          >
            <Bell size={16} strokeWidth={1.75} />
          </button>
          <LanguageSwitcher />
        </div>
      </div>

      <div className="mt-5">
        <AgencyIdentityCard agency={agency} />
      </div>

      <div className="mt-5">
        <AgencyStatsGrid agency={agency} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.7fr_1fr]">
        <AgencyConditionsBlock conditions={agency.conditionKeys} />
        <AgencyContactCard contact={agency.contact} />
      </div>

      <div className="mt-5">
        <AgencyPropertiesTable properties={agency.properties} />
      </div>

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}
