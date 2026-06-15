"use client";

import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createFeed } from "@/app/(admin)/admin/sindicacion/actions";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/lib/i18n/provider";

export type AgencyOption = {
  id: string;
  name: string;
  slug: string;
};

export type ScraperOption = {
  key: string;
  label: string;
};

export function NewFeedModal({
  open,
  onClose,
  agenciesWithoutFeed,
  scrapers,
}: {
  open: boolean;
  onClose: () => void;
  agenciesWithoutFeed: AgencyOption[];
  scrapers: ScraperOption[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [agencyId, setAgencyId] = useState("");
  const [scraperKey, setScraperKey] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [frequencyHours, setFrequencyHours] = useState(6);

  useEffect(() => {
    if (!open) {
      setAgencyId("");
      setScraperKey("");
      setFeedUrl("");
      setFrequencyHours(6);
      setError(null);
    }
  }, [open]);

  const canSubmit =
    agencyId.length > 0 && scraperKey.length > 0 && !pending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const res = await createFeed({
        agencyId,
        scraperKey,
        feedUrl: feedUrl.trim() || undefined,
        frequencyHours,
      });
      if (res.ok) {
        onClose();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const noAgencies = agenciesWithoutFeed.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      isPending={pending}
      title={t("sindicacion.new.title")}
      subtitle={t("sindicacion.new.subtitle")}
      size="lg"
    >
      {noAgencies ? (
        <div className="rounded-xl border border-gold/20 bg-white/55 p-6 text-center text-sm text-ink/65">
          {t("sindicacion.new.noAgencies")}
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t("sindicacion.new.agency")}>
            <select
              value={agencyId}
              onChange={(e) => setAgencyId(e.target.value)}
              className="w-full rounded-lg border border-ink/10 bg-white/85 px-3 py-2 text-sm text-ink focus:border-gold/55 focus:outline-none"
            >
              <option value="">{t("sindicacion.new.selectAgency")}</option>
              {agenciesWithoutFeed.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("sindicacion.new.scraper")}>
            <select
              value={scraperKey}
              onChange={(e) => setScraperKey(e.target.value)}
              className="w-full rounded-lg border border-ink/10 bg-white/85 px-3 py-2 text-sm text-ink focus:border-gold/55 focus:outline-none"
            >
              <option value="">{t("sindicacion.new.selectScraper")}</option>
              {scrapers.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink/55">
              {t("sindicacion.new.scraperHelp")}
            </p>
          </Field>

          <Field label={t("sindicacion.new.feedUrl")}>
            <input
              type="url"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder="https://levelrealestate.es/propiedades"
              className="w-full rounded-lg border border-ink/10 bg-white/85 px-3 py-2 text-sm text-ink focus:border-gold/55 focus:outline-none"
            />
          </Field>

          <Field label={t("sindicacion.new.frequency")}>
            <select
              value={frequencyHours}
              onChange={(e) => setFrequencyHours(Number(e.target.value))}
              className="w-full rounded-lg border border-ink/10 bg-white/85 px-3 py-2 text-sm text-ink focus:border-gold/55 focus:outline-none"
            >
              {[1, 3, 6, 12, 24].map((h) => (
                <option key={h} value={h}>
                  {t("sindicacion.table.everyHours", { n: h })}
                </option>
              ))}
            </select>
          </Field>

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50/85 px-3 py-2 text-[12px] text-rose-700">
              {t("sindicacion.toast.error", { error })}
            </p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-lg border border-ink/15 bg-white/85 px-4 py-2 text-[12px] font-medium text-ink/75 transition hover:bg-white"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-cream-50 transition hover:bg-ink-soft disabled:opacity-50"
            >
              {pending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Plus size={13} strokeWidth={2} className="text-gold" />
              )}
              <span>{t("sindicacion.new.submit")}</span>
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[12px] font-medium text-ink/80">
      <span>{label}</span>
      {children}
    </label>
  );
}
