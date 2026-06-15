"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  TriangleAlert,
} from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { formatRelativeMinutes } from "@/lib/relative-time";

export type RecentSyncVM = {
  id: string;
  agencyName: string;
  status: "running" | "success" | "partial" | "error";
  triggeredBy: string;
  startedMinutesAgo: number;
  durationSeconds: number | null;
  inserted: number;
  updated: number;
  archived: number;
  errorMessage: string | null;
};

const STATUS_ICON = {
  running: Clock,
  success: CheckCircle2,
  partial: TriangleAlert,
  error: AlertCircle,
};

const STATUS_TONE: Record<
  RecentSyncVM["status"],
  { bgClass: string; textClass: string; labelKey: string }
> = {
  running: {
    bgClass: "bg-ink/5",
    textClass: "text-ink/65",
    labelKey: "sindicacion.status.running",
  },
  success: {
    bgClass: "bg-emerald-50",
    textClass: "text-emerald-700",
    labelKey: "sindicacion.status.success",
  },
  partial: {
    bgClass: "bg-amber-50",
    textClass: "text-amber-700",
    labelKey: "sindicacion.status.partial",
  },
  error: {
    bgClass: "bg-rose-50",
    textClass: "text-rose-700",
    labelKey: "sindicacion.status.error",
  },
};

export function RecentSyncsPanel({ logs }: { logs: RecentSyncVM[] }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/80 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.25)] backdrop-blur-sm md:p-6">
      <h2 className="font-serif text-xl font-medium text-ink">
        {t("sindicacion.recent.title")}
      </h2>
      <p className="mt-0.5 text-[12px] text-ink/55">
        {t("sindicacion.recent.subtitle")}
      </p>

      <ul className="mt-4 space-y-2">
        {logs.length === 0 ? (
          <li className="rounded-xl border border-dashed border-gold/25 bg-white/40 px-4 py-8 text-center text-[12px] text-ink/55">
            {t("sindicacion.recent.empty")}
          </li>
        ) : (
          logs.map((log) => {
            const tone = STATUS_TONE[log.status];
            const Icon = STATUS_ICON[log.status];
            return (
              <li
                key={log.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-ink/5 bg-white/65 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone.bgClass} ${tone.textClass}`}
                  >
                    <Icon size={14} strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {log.agencyName}
                    </p>
                    <p className="text-[11px] text-ink/55">
                      {t(tone.labelKey)} ·{" "}
                      {t(`sindicacion.trigger.${log.triggeredBy}`)}
                      {" · "}
                      {formatRelativeMinutes(log.startedMinutesAgo, t)}
                      {log.durationSeconds != null
                        ? ` · ${log.durationSeconds}s`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-[11px] text-ink/70">
                  <Counter
                    labelKey="sindicacion.counters.inserted"
                    value={log.inserted}
                  />
                  <Counter
                    labelKey="sindicacion.counters.updated"
                    value={log.updated}
                  />
                  <Counter
                    labelKey="sindicacion.counters.archived"
                    value={log.archived}
                  />
                </div>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

function Counter({ labelKey, value }: { labelKey: string; value: number }) {
  const t = useT();
  return (
    <span className="inline-flex flex-col items-end leading-none">
      <span className="font-mono text-sm text-ink">{value}</span>
      <span className="text-[9px] uppercase tracking-[0.14em] text-ink/45">
        {t(labelKey)}
      </span>
    </span>
  );
}
