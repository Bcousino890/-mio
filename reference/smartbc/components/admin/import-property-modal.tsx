"use client";

import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { importPropertyFromUrl } from "@/app/(admin)/admin/propiedades/import-actions";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/lib/i18n/provider";

type Feedback =
  | { kind: "idle" }
  | { kind: "soon" }
  | { kind: "error"; msg: string };

export function ImportPropertyModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });

  useEffect(() => {
    if (!open) {
      setUrl("");
      setFeedback({ kind: "idle" });
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setFeedback({ kind: "idle" });
    startTransition(async () => {
      const res = await importPropertyFromUrl({ url: trimmed });
      if (res.ok) {
        onClose();
      } else if (res.error === "not_implemented") {
        setFeedback({ kind: "soon" });
      } else {
        setFeedback({ kind: "error", msg: res.error });
      }
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      isPending={isPending}
      title={t("adminProps.import.title")}
      subtitle={t("adminProps.import.subtitle")}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[12px] font-medium text-ink/80">
          <span>{t("adminProps.import.urlLabel")}</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.idealista.com/..."
            autoFocus
            required
            className="w-full rounded-lg border border-ink/10 bg-white/85 px-3 py-2.5 text-sm text-ink focus:border-gold/55 focus:outline-none"
          />
          <span className="text-[11px] font-normal text-ink/55">
            {t("adminProps.import.urlHint")}
          </span>
        </label>

        {feedback.kind === "soon" && (
          <div className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/10 p-3 text-[12px] text-ink/80">
            <Sparkles
              size={14}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0 text-gold-dark"
            />
            <span>{t("adminProps.import.soon")}</span>
          </div>
        )}

        {feedback.kind === "error" && (
          <div className="rounded-lg border border-rose-200 bg-rose-50/85 px-3 py-2 text-[12px] text-rose-700">
            {t("adminProps.import.error", { error: feedback.msg })}
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-ink/15 bg-white/85 px-4 py-2 text-[12px] font-medium text-ink/75 transition hover:bg-white"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={isPending || url.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-cream-50 transition hover:bg-ink-soft disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Wand2 size={13} strokeWidth={2} className="text-gold" />
            )}
            <span>{t("adminProps.import.submit")}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
