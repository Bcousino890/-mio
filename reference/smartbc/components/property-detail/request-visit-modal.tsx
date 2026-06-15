"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { requestVisit } from "@/app/(cliente)/actions";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

type Feedback =
  | { kind: "idle" }
  | { kind: "success" }
  | { kind: "error"; msg: string };

export function RequestVisitModal({
  open,
  onClose,
  propertySlug,
  propertyTitle,
}: {
  open: boolean;
  onClose: () => void;
  propertySlug: string;
  propertyTitle: string;
}) {
  const t = useT();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  const [date, setDate] = useState("");
  const [time, setTime] = useState("11:00");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) {
      setDate("");
      setTime("11:00");
      setNotes("");
      setFeedback({ kind: "idle" });
    }
  }, [open]);

  const canSubmit = date.length === 10 && time.length >= 4 && !isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setFeedback({ kind: "idle" });

    const requestedAt = new Date(`${date}T${time}:00`).toISOString();

    startTransition(async () => {
      const result = await requestVisit({
        slug: propertySlug,
        requestedAt,
        notes: notes.trim() || undefined,
      });
      if (result.ok) {
        setFeedback({ kind: "success" });
        setTimeout(onClose, 1500);
      } else {
        setFeedback({
          kind: "error",
          msg: humanError(t, result.error),
        });
      }
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      isPending={isPending}
      title={t("detail.visit.title")}
      subtitle={propertyTitle}
    >
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[12px] font-medium text-ink/65">
            <span>
              {t("detail.visit.field.date")}
              <span className="ml-1 text-gold-dark">*</span>
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[13px] text-ink focus:border-gold/55 focus:outline-none"
            />
          </label>
          <label className="block text-[12px] font-medium text-ink/65">
            <span>
              {t("detail.visit.field.time")}
              <span className="ml-1 text-gold-dark">*</span>
            </span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[13px] text-ink focus:border-gold/55 focus:outline-none"
            />
          </label>
        </div>

        <label className="mt-4 block text-[12px] font-medium text-ink/65">
          <span>{t("detail.visit.field.notes")}</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[13px] text-ink placeholder:text-ink/35 focus:border-gold/55 focus:outline-none"
            placeholder={t("detail.visit.field.notes.placeholder")}
          />
        </label>

        {feedback.kind === "success" && (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-700">
            <Check size={14} strokeWidth={2} />
            <span>{t("detail.visit.success")}</span>
          </p>
        )}
        {feedback.kind === "error" && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
            {feedback.msg}
          </p>
        )}

        <footer className="mt-6 flex items-center justify-end gap-2.5 border-t border-gold/15 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-[13px] font-medium text-ink/70 transition hover:border-ink/30 hover:text-ink disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-cream-50 transition",
              "hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isPending ? (
              <Loader2
                size={14}
                strokeWidth={1.75}
                className="animate-spin text-gold"
              />
            ) : (
              <Check size={14} strokeWidth={1.75} className="text-gold" />
            )}
            <span>
              {isPending
                ? t("detail.visit.sending")
                : t("detail.visit.send")}
            </span>
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function humanError(t: (key: string) => string, code: string): string {
  const known: Record<string, string> = {
    no_session: t("detail.visit.error.noSession"),
    property_not_found: t("detail.visit.error.notFound"),
    date_required: t("detail.visit.error.dateRequired"),
  };
  return known[code] ?? `${t("detail.visit.error.generic")} · ${code}`;
}
