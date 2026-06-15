"use client";

import { Building2, Check, Home, RotateCcw, Save, Tag } from "lucide-react";
import { useState, useTransition } from "react";
import { saveAgencyPartnership } from "@/app/(admin)/admin/agencias/[id]/actions";
import { StatCard } from "@/components/ui/stat-card";
import { formatPrice } from "@/lib/format";
import { useT } from "@/lib/i18n/provider";
import type { AgencyDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

type FeedbackKind = "idle" | "saved" | "error";

export function AgencyStatsGrid({ agency }: { agency: AgencyDetail }) {
  const t = useT();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<FeedbackKind>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Snapshot inicial — lo que está guardado en BD.
  const initialRentMin = agency.rentCommissionMinPrice;
  const initialSaleAgreed = agency.saleAgreedCommissionPct || 0;

  // Estado editable.
  const [rentMinPrice, setRentMinPrice] = useState<number>(initialRentMin);
  const [saleAgreedPct, setSaleAgreedPct] = useState<number>(initialSaleAgreed);

  const saleEffectivePct = saleAgreedPct / 2;
  const isDirty =
    rentMinPrice !== initialRentMin || saleAgreedPct !== initialSaleAgreed;

  const handleSave = () => {
    setFeedback("idle");
    setErrorMsg(null);
    startTransition(async () => {
      const result = await saveAgencyPartnership({
        slug: agency.id,
        rentCommissionMinPrice: rentMinPrice,
        saleAgreedCommissionPct: saleAgreedPct,
      });
      if (result.ok) {
        setFeedback("saved");
        setTimeout(() => setFeedback("idle"), 2500);
      } else {
        setFeedback("error");
        setErrorMsg(result.error);
      }
    });
  };

  const handleReset = () => {
    setRentMinPrice(initialRentMin);
    setSaleAgreedPct(initialSaleAgreed);
    setFeedback("idle");
    setErrorMsg(null);
  };

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          labelKey="agency.stats.rentCommission"
          helpKey="agency.stats.rentCommission.help"
          value={`${agency.rentCommissionPct}%`}
          rightSlot={<Donut percent={agency.rentCommissionPct} />}
          footer={
            <RentMinPriceSelect value={rentMinPrice} onChange={setRentMinPrice} />
          }
        />
        <StatCard
          labelKey="agency.stats.saleCommission"
          helpKey="agency.stats.saleCommission.help"
          value={formatPct(saleEffectivePct)}
          rightSlot={<Donut percent={saleEffectivePct} />}
          footer={
            <SaleAgreedSelect
              value={saleAgreedPct}
              onChange={setSaleAgreedPct}
              effectivePct={saleEffectivePct}
              label={t("agency.stats.agreedSale.label")}
            />
          }
        />
        <StatCard
          labelKey="agency.stats.rentCount"
          helpKey="agency.stats.availableNow"
          value={agency.rentCount}
          rightSlot={
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
              <Home size={20} strokeWidth={1.75} />
            </span>
          }
        />
        <StatCard
          labelKey="agency.stats.saleCount"
          helpKey="agency.stats.availableNow"
          value={agency.saleCount}
          rightSlot={
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
              <Tag size={19} strokeWidth={1.75} />
            </span>
          }
        />
        <StatCard
          labelKey="agency.stats.totalCount"
          helpKey="agency.stats.availableNow"
          value={agency.rentCount + agency.saleCount}
          rightSlot={
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
              <Building2 size={20} strokeWidth={1.75} />
            </span>
          }
        />
      </div>

      <SaveBar
        isDirty={isDirty}
        isPending={isPending}
        feedback={feedback}
        errorMsg={errorMsg}
        onSave={handleSave}
        onReset={handleReset}
      />
    </section>
  );
}

function SaveBar({
  isDirty,
  isPending,
  feedback,
  errorMsg,
  onSave,
  onReset,
}: {
  isDirty: boolean;
  isPending: boolean;
  feedback: FeedbackKind;
  errorMsg: string | null;
  onSave: () => void;
  onReset: () => void;
}) {
  const t = useT();
  if (!isDirty && feedback === "idle") return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2.5 rounded-xl border border-gold/20 bg-cream-50/85 px-4 py-2.5 backdrop-blur-sm">
      {feedback === "saved" && (
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
          <Check size={14} strokeWidth={2} />
          <span>{t("agency.commission.saved")}</span>
        </span>
      )}
      {feedback === "error" && (
        <span className="text-[12px] font-medium text-red-600">
          {t("agency.commission.error")}
          {errorMsg ? ` · ${errorMsg}` : ""}
        </span>
      )}
      {feedback === "idle" && isDirty && (
        <span className="text-[12px] text-ink/60">
          {t("agency.commission.unsaved")}
        </span>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReset}
          disabled={isPending || !isDirty}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white/80 px-3 py-1.5 text-[12px] font-medium text-ink/70 transition",
            "hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <RotateCcw size={13} strokeWidth={1.75} />
          <span>{t("agency.commission.reset")}</span>
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isPending || !isDirty}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-1.5 text-[12px] font-medium text-cream-50 transition",
            "hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <Save size={13} strokeWidth={1.75} className="text-gold" />
          <span>
            {isPending
              ? t("agency.commission.saving")
              : t("agency.commission.save")}
          </span>
        </button>
      </div>
    </div>
  );
}

const RENT_THRESHOLDS = [0, 1000, 1500, 1800, 2200, 2500, 3000, 3500, 4000, 5000];
const SALE_AGREED_OPTIONS = [0, 1, 2, 3, 4, 5, 6];

function RentMinPriceSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const t = useT();
  const allOptions = RENT_THRESHOLDS.includes(value)
    ? RENT_THRESHOLDS
    : [...RENT_THRESHOLDS, value].sort((a, b) => a - b);

  const formatLabel = (v: number) => {
    if (v <= 0) return t("agency.stats.minPrice.notSet");
    return `${t("agency.stats.minPrice", { price: formatPrice(v) })}${t("agency.stats.minPrice.rentSuffix")}`;
  };

  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full appearance-none rounded-lg border border-gold/25 bg-white/70 px-2.5 py-1.5 text-[11px] font-medium text-ink/75 focus:border-gold/55 focus:outline-none"
    >
      {allOptions.map((v) => (
        <option key={v} value={v}>
          {formatLabel(v)}
        </option>
      ))}
    </select>
  );
}

function SaleAgreedSelect({
  value,
  onChange,
  effectivePct,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  effectivePct: number;
  label: string;
}) {
  const t = useT();
  const allOptions = SALE_AGREED_OPTIONS.includes(value)
    ? SALE_AGREED_OPTIONS
    : [...SALE_AGREED_OPTIONS, value].sort((a, b) => a - b);

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ink/45">
        {label}
      </p>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full appearance-none rounded-lg border border-gold/25 bg-white/70 px-2.5 py-1.5 text-[11px] font-medium text-ink/75 focus:border-gold/55 focus:outline-none"
      >
        {allOptions.map((v) =>
          v <= 0 ? (
            <option key={v} value={v}>
              {t("agency.stats.agreedSale.notSet")}
            </option>
          ) : (
            <option key={v} value={v}>
              {t("agency.stats.agreedSale.option", {
                agreed: formatPct(v),
                effective: formatPct(v / 2),
              })}
            </option>
          ),
        )}
      </select>
      {value > 0 && (
        <p className="text-[10px] text-ink/45">
          {t("agency.stats.agreedSale.effectiveHint", {
            agreed: formatPct(value),
            effective: formatPct(effectivePct),
          })}
        </p>
      )}
    </div>
  );
}

function formatPct(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function Donut({ percent }: { percent: number }) {
  const safe = Math.max(0, Math.min(100, percent));
  return (
    <svg
      viewBox="0 0 36 36"
      className="h-14 w-14 shrink-0"
      aria-hidden="true"
    >
      <circle
        cx="18"
        cy="18"
        r="15.9155"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        className="text-gold/15"
      />
      <circle
        cx="18"
        cy="18"
        r="15.9155"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray={`${safe} ${100 - safe}`}
        strokeLinecap="round"
        transform="rotate(-90 18 18)"
        className="text-gold"
      />
    </svg>
  );
}
