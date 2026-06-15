"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/provider";
import { formatRelativeMinutes } from "@/lib/relative-time";
import type { VisitRequest, VisitRequestStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { updateVisitStatus } from "./actions";

// ─── Status config ─────────────────────────────────────────────────────────

type TabKey = "pending" | "confirmed" | "completed" | "rejected";

const TAB_ORDER: TabKey[] = ["pending", "confirmed", "completed", "rejected"];

const STATUS_BADGE: Record<VisitRequestStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rescheduled: "border-blue-200 bg-blue-50 text-blue-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
  completed: "border-violet-200 bg-violet-50 text-violet-700",
};

const TAB_STATUS_MAP: Record<TabKey, VisitRequestStatus> = {
  pending: "pending",
  confirmed: "confirmed",
  completed: "completed",
  rejected: "rejected",
};

const TAB_LABEL_KEY: Record<TabKey, string> = {
  pending: "solicitudes.tab.pending",
  confirmed: "solicitudes.tab.confirmed",
  completed: "solicitudes.tab.completed",
  rejected: "solicitudes.tab.rejected",
};

const TAB_BADGE_CLASS: Record<TabKey, string> = {
  pending: "bg-amber-100 text-amber-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  completed: "bg-violet-100 text-violet-700",
  rejected: "bg-rose-100 text-rose-700",
};

// ─── Main component ─────────────────────────────────────────────────────────

export function SolicitudesAdminClient({
  requests,
}: {
  requests: VisitRequest[];
}) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabKey>("pending");

  const counts: Record<TabKey, number> = {
    pending: requests.filter((r) => r.status === "pending").length,
    confirmed: requests.filter((r) => r.status === "confirmed").length,
    completed: requests.filter((r) => r.status === "completed").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  };

  const filtered = requests.filter(
    (r) => r.status === TAB_STATUS_MAP[activeTab],
  );

  return (
    <section className="mt-5">
      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-gold/15 pb-0">
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "relative flex items-center gap-2 rounded-t-xl border border-b-0 px-4 py-2.5 text-[13px] font-medium transition",
              activeTab === tab
                ? "border-gold/20 bg-cream-50/90 text-ink shadow-[0_-4px_12px_-6px_rgba(40,28,10,0.10)]"
                : "border-transparent text-ink/50 hover:text-ink/75",
            )}
          >
            {t(TAB_LABEL_KEY[tab])}
            {counts[tab] > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
                  activeTab === tab
                    ? TAB_BADGE_CLASS[tab]
                    : "bg-ink/8 text-ink/50",
                )}
              >
                {counts[tab]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div className="mt-4">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-gold/15 bg-cream-50/60 py-14 text-center text-sm text-ink/45">
            {t("solicitudes.empty")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((r) => (
              <RequestCard key={r.id} request={r} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

function RequestCard({ request }: { request: VisitRequest }) {
  const t = useT();
  const [isTransitioning, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(
    request.status,
  );

  const isPendingStatus = optimisticStatus === "pending";

  function handleConfirm() {
    startTransition(async () => {
      setOptimisticStatus("confirmed");
      await updateVisitStatus(request.id, "confirmed");
    });
  }

  function handleCancel() {
    startTransition(async () => {
      setOptimisticStatus("rejected");
      await updateVisitStatus(request.id, "cancelled");
    });
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-gold/15 bg-cream-50/85 p-4 shadow-[0_8px_25px_-10px_rgba(40,28,10,0.12)] transition-opacity",
        isTransitioning && "opacity-60",
      )}
    >
      {/* Header: avatar + nombre + email + badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/15 text-sm font-bold text-amber-800">
            {request.clientInitials}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink text-sm leading-tight">
              {request.clientName}
            </p>
            {request.clientEmail && (
              <p className="truncate text-[11px] text-ink/50 leading-tight mt-0.5">
                {request.clientEmail}
              </p>
            )}
          </div>
        </div>
        <StatusBadge status={optimisticStatus} />
      </div>

      {/* Propiedad */}
      <div className="mt-3 rounded-lg border border-ink/5 bg-ink/[0.03] px-3 py-2">
        {request.propertySlug ? (
          <a
            href={`/admin/propiedades/${request.propertySlug}`}
            className="block group"
          >
            <p className="text-[12px] font-medium text-ink/75 group-hover:text-amber-800 transition-colors truncate">
              📍 {request.propertyTitle}
            </p>
            {request.propertyReference && (
              <p className="text-[11px] text-ink/40 mt-0.5">
                {request.propertyReference}
              </p>
            )}
          </a>
        ) : (
          <>
            <p className="text-[12px] text-ink/70 truncate">
              📍 {request.propertyTitle}
            </p>
            {request.propertyReference && (
              <p className="text-[11px] text-ink/40 mt-0.5">
                {request.propertyReference}
              </p>
            )}
          </>
        )}
      </div>

      {/* Fechas */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink/50">
        <span>🗓 {request.requestedDateLabel}</span>
        <span className="text-ink/30">·</span>
        <span>
          {t("solicitudes.received")}{" "}
          {formatRelativeMinutes(request.receivedRelativeMinutes, t)}
        </span>
      </div>

      {/* Acciones para pendientes */}
      {isPendingStatus && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isTransitioning}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            <CheckCircle2 size={13} strokeWidth={2} />
            {t("solicitudes.action.confirm")}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isTransitioning}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
          >
            <XCircle size={13} strokeWidth={2} />
            {t("solicitudes.action.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: VisitRequestStatus }) {
  const t = useT();
  return (
    <span
      className={cn(
        "shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-semibold",
        STATUS_BADGE[status],
      )}
    >
      {t(`solicitudes.status.${status}`)}
    </span>
  );
}
