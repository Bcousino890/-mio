"use client";

import {
  AlertCircle,
  Check,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState, useTransition } from "react";
import {
  deleteFeed,
  setFeedActive,
  syncFeedNow,
} from "@/app/(admin)/admin/sindicacion/actions";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { formatRelativeMinutes } from "@/lib/relative-time";

export type FeedRowVM = {
  id: string;
  agencyName: string;
  agencySlug: string;
  scraperKey: string;
  active: boolean;
  health: "healthy" | "warning" | "error" | "idle";
  lastStatus: "running" | "success" | "partial" | "error" | null;
  lastError: string | null;
  lastRunMinutesAgo: number | null;
  frequencyHours: number;
};

const HEALTH_BADGE: Record<
  FeedRowVM["health"],
  { bgClass: string; textClass: string; labelKey: string }
> = {
  healthy: {
    bgClass: "bg-emerald-100 border-emerald-200",
    textClass: "text-emerald-700",
    labelKey: "sindicacion.health.healthy",
  },
  warning: {
    bgClass: "bg-amber-100 border-amber-200",
    textClass: "text-amber-700",
    labelKey: "sindicacion.health.warning",
  },
  error: {
    bgClass: "bg-rose-100 border-rose-200",
    textClass: "text-rose-700",
    labelKey: "sindicacion.health.error",
  },
  idle: {
    bgClass: "bg-ink/5 border-ink/10",
    textClass: "text-ink/60",
    labelKey: "sindicacion.health.idle",
  },
};

export function FeedsTable({
  feeds,
  onCreateClick,
}: {
  feeds: FeedRowVM[];
  onCreateClick: () => void;
}) {
  const t = useT();

  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/80 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.25)] backdrop-blur-sm md:p-6">
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h2 className="font-serif text-xl font-medium text-ink">
            {t("sindicacion.feeds.title")}
          </h2>
          <p className="mt-0.5 text-[12px] text-ink/55">
            {t("sindicacion.feeds.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateClick}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-cream-50 transition hover:bg-ink-soft"
        >
          <Plus size={14} strokeWidth={1.75} className="text-gold" />
          <span>{t("sindicacion.new.button")}</span>
        </button>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[860px] border-separate border-spacing-y-1.5 text-left text-sm">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
              <th className="px-4 pb-2">{t("sindicacion.table.agency")}</th>
              <th className="px-4 pb-2">{t("sindicacion.table.scraper")}</th>
              <th className="px-4 pb-2">{t("sindicacion.table.health")}</th>
              <th className="px-4 pb-2">{t("sindicacion.table.lastRun")}</th>
              <th className="px-4 pb-2">{t("sindicacion.table.frequency")}</th>
              <th className="px-4 pb-2 text-right">
                {t("sindicacion.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {feeds.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="rounded-xl border border-dashed border-gold/25 bg-white/40 px-4 py-10 text-center text-ink/55"
                >
                  {t("sindicacion.table.empty")}
                </td>
              </tr>
            ) : (
              feeds.map((f) => <FeedRow key={f.id} feed={f} />)
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FeedRow({ feed }: { feed: FeedRowVM }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const badge = HEALTH_BADGE[feed.health];

  // Si la BD dice que el último run sigue 'running', evitamos disparar otro
  // sync por encima. El usuario puede esperar a que termine o pulsar pausa.
  const isRunning = feed.lastStatus === "running";
  const blocked = pending || isRunning;

  const runSync = () => {
    if (isRunning) {
      setFlash(t("sindicacion.toast.alreadyRunning"));
      return;
    }
    setFlash(null);
    startTransition(async () => {
      const res = await syncFeedNow(feed.id);
      if (res.ok) {
        const c = res.counters;
        setFlash(
          t("sindicacion.toast.success", {
            inserted: c.inserted,
            updated: c.updated,
            archived: c.archived,
          }),
        );
      } else {
        setFlash(t("sindicacion.toast.error", { error: res.error }));
      }
    });
  };

  const toggleActive = () => {
    startTransition(async () => {
      const res = await setFeedActive(feed.id, !feed.active);
      if (!res.ok) setFlash(t("sindicacion.toast.error", { error: res.error }));
    });
  };

  const removeFeed = () => {
    if (!confirm(t("sindicacion.confirmDelete"))) return;
    startTransition(async () => {
      const res = await deleteFeed(feed.id);
      if (!res.ok) setFlash(t("sindicacion.toast.error", { error: res.error }));
    });
  };

  return (
    <>
      <tr className={cn("bg-white/55 transition", !feed.active && "opacity-60")}>
        <td className="rounded-l-xl px-4 py-3">
          <p className="font-medium text-ink">{feed.agencyName}</p>
          <p className="text-[11px] text-ink/55">{feed.agencySlug}</p>
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center rounded-md border border-ink/10 bg-white/85 px-2 py-1 font-mono text-[11px] text-ink/75">
            {feed.scraperKey}
          </span>
        </td>
        <td className="px-4 py-3">
          {isRunning ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-[11px] font-medium text-gold-dark">
              <Loader2 size={11} className="animate-spin" />
              {t("sindicacion.status.running")}
            </span>
          ) : (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                badge.bgClass,
                badge.textClass,
              )}
            >
              {feed.health === "error" ? (
                <AlertCircle size={11} strokeWidth={2} />
              ) : feed.health === "healthy" ? (
                <Check size={11} strokeWidth={2.25} />
              ) : null}
              {t(badge.labelKey)}
            </span>
          )}
          {feed.lastError && feed.health !== "healthy" && !isRunning && (
            <p className="mt-1 max-w-[220px] truncate text-[10px] text-rose-600/85">
              {feed.lastError}
            </p>
          )}
        </td>
        <td className="px-4 py-3 text-[12px] text-ink/65">
          {feed.lastRunMinutesAgo == null
            ? t("sindicacion.table.neverRun")
            : formatRelativeMinutes(feed.lastRunMinutesAgo, t)}
        </td>
        <td className="px-4 py-3 text-[12px] text-ink/65">
          {t("sindicacion.table.everyHours", { n: feed.frequencyHours })}
        </td>
        <td className="rounded-r-xl px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={runSync}
              disabled={blocked}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-[11px] font-medium text-cream-50 transition hover:bg-ink-soft disabled:opacity-50"
              title={
                isRunning
                  ? t("sindicacion.actions.alreadyRunning")
                  : t("sindicacion.actions.syncNow")
              }
            >
              {pending || isRunning ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} strokeWidth={2} className="text-gold" />
              )}
              <span>{t("sindicacion.actions.syncNow")}</span>
            </button>
            <button
              type="button"
              onClick={toggleActive}
              disabled={blocked}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 bg-white/85 text-ink/65 transition hover:border-gold/45 hover:text-ink disabled:opacity-50"
              title={
                feed.active
                  ? t("sindicacion.actions.pause")
                  : t("sindicacion.actions.resume")
              }
            >
              {feed.active ? (
                <Pause size={12} strokeWidth={2} />
              ) : (
                <Play size={12} strokeWidth={2} />
              )}
            </button>
            <button
              type="button"
              onClick={removeFeed}
              disabled={blocked}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 bg-white/85 text-ink/55 transition hover:border-rose-300/60 hover:text-rose-600 disabled:opacity-50"
              title={t("sindicacion.actions.delete")}
            >
              <Trash2 size={12} strokeWidth={2} />
            </button>
          </div>
        </td>
      </tr>
      {flash && (
        <tr>
          <td colSpan={6} className="px-4 pb-3">
            <div className="rounded-lg border border-gold/25 bg-white/75 px-3 py-2 text-[12px] text-ink/75">
              {flash}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
