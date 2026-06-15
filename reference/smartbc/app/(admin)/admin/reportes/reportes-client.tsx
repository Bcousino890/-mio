"use client";

import { Building2, Link2, Users, CalendarClock } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageFooter } from "@/components/ui/page-footer";
import { StatCard } from "@/components/ui/stat-card";
import { useT } from "@/lib/i18n/provider";
import type { ReportsStatsData } from "@/lib/db/queries/reports";

interface ReportesClientProps {
  stats: ReportsStatsData;
}

export function ReportesClient({ stats }: ReportesClientProps) {
  const t = useT();

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="reportes.title"
        subtitleKey="reportes.subtitle"
      />

      {/* KPIs */}
      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Building2 size={20} strokeWidth={1.75} />}
          labelKey="reportes.kpi.properties"
          value={stats.totalProperties}
          helpKey="reportes.kpi.properties.help"
        />
        <StatCard
          icon={<Users size={20} strokeWidth={1.75} />}
          labelKey="reportes.kpi.clients"
          value={stats.totalClients}
          helpKey="reportes.kpi.clients.help"
        />
        <StatCard
          icon={<CalendarClock size={20} strokeWidth={1.75} />}
          labelKey="reportes.kpi.visits"
          value={stats.visitsThisMonth}
          helpKey="reportes.kpi.visits.help"
        />
        <StatCard
          icon={<Link2 size={20} strokeWidth={1.75} />}
          labelKey="reportes.kpi.smartlinks"
          value={stats.totalSmartLinkOpens}
          helpKey="reportes.kpi.smartlinks.help"
        />
      </div>

      {/* Charts */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.7fr_1fr]">
        <ZoneChart byZone={stats.byZone} />
        <OperationChart byOperation={stats.byOperation} />
      </div>

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}

function ZoneChart({ byZone }: { byZone: Array<[string, number]> }) {
  const t = useT();
  const max = byZone.length > 0 ? Math.max(...byZone.map(([, c]) => c)) : 1;

  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-6">
      <header>
        <h2 className="font-serif text-xl font-semibold text-ink">
          {t("reportes.zone.title")}
        </h2>
        <p className="text-[12px] text-ink/55">
          {t("reportes.zone.subtitle")}
        </p>
      </header>

      {byZone.length === 0 ? (
        <p className="mt-8 text-center text-sm text-ink/40">—</p>
      ) : (
        <div className="mt-6 space-y-3">
          {byZone.map(([zone, count]) => {
            const pct = Math.round((count / max) * 100);
            return (
              <div key={zone} className="flex items-center gap-3">
                <span className="w-28 truncate text-right text-[12px] text-ink/70 shrink-0">
                  {zone}
                </span>
                <div className="flex flex-1 items-center gap-2">
                  <div className="h-5 rounded-md bg-gold/20 overflow-hidden flex-1">
                    <div
                      className="h-full rounded-md bg-gold transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-serif text-[13px] font-semibold text-ink">
                    {count}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function OperationChart({
  byOperation,
}: {
  byOperation: Record<string, number>;
}) {
  const t = useT();
  const total = Object.values(byOperation).reduce((a, b) => a + b, 0);

  const rentCount = byOperation["rent"] ?? byOperation["alquiler"] ?? 0;
  const saleCount = byOperation["sale"] ?? byOperation["venta"] ?? 0;
  const otherCount = total - rentCount - saleCount;

  const rows: Array<{ labelKey: string; count: number; color: string }> = [
    {
      labelKey: "reportes.operation.rent",
      count: rentCount,
      color: "bg-gold",
    },
    {
      labelKey: "reportes.operation.sale",
      count: saleCount,
      color: "bg-ink",
    },
  ];
  if (otherCount > 0) {
    rows.push({
      labelKey: "reportes.operation.other",
      count: otherCount,
      color: "bg-ink/30",
    });
  }

  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-6">
      <header>
        <h2 className="font-serif text-xl font-semibold text-ink">
          {t("reportes.operation.title")}
        </h2>
        <p className="text-[12px] text-ink/55">
          {t("reportes.operation.subtitle")}
        </p>
      </header>

      {total === 0 ? (
        <p className="mt-8 text-center text-sm text-ink/40">—</p>
      ) : (
        <>
          {/* Stacked bar */}
          <div className="mt-6 flex h-6 overflow-hidden rounded-lg">
            {rows.map(({ labelKey, count, color }) => {
              const w = (count / total) * 100;
              if (w === 0) return null;
              return (
                <div
                  key={labelKey}
                  className={`${color} transition-all`}
                  style={{ width: `${w}%` }}
                  title={`${t(labelKey)}: ${count}`}
                />
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-5 space-y-3">
            {rows.map(({ labelKey, count, color }) => {
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div
                  key={labelKey}
                  className="flex items-center justify-between rounded-xl border border-gold/15 bg-white/55 px-3 py-2"
                >
                  <span className="flex items-center gap-2 text-sm text-ink">
                    <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
                    {t(labelKey)}
                  </span>
                  <span className="font-serif text-base font-semibold text-ink">
                    {count}
                    <span className="ml-1.5 text-[11px] font-normal text-ink/50">
                      {pct}%
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
