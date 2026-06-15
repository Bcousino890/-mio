"use client";

import {
  BarChart3,
  Check,
  Copy,
  Link2,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createShareLink,
  deleteShareLink,
} from "@/app/(admin)/admin/propiedades/actions";
import { useT } from "@/lib/i18n/provider";
import { formatRelativeMinutes } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

export type SmartLinkRow = {
  id: string;
  token: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  opens_count: number;
  last_opened_at: string | null;
};

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 60000),
  );
}

export function SmartLinksPanel({
  slug,
  initialLinks,
}: {
  slug: string;
  initialLinks: SmartLinkRow[];
}) {
  const t = useT();
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [creating, startCreate] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startCreate(async () => {
      const res = await createShareLink(slug, label || null);
      if (res.ok) {
        setLabel("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div>
      <p className="mt-1 text-[12px] text-ink/55">
        {t("adminProps.smartLinks.help")}
      </p>

      {/* Crear nuevo link */}
      <form onSubmit={handleCreate} className="mt-4 flex gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("adminProps.smartLinks.labelPlaceholder")}
          maxLength={80}
          className="flex-1 rounded-lg border border-ink/10 bg-white/85 px-3 py-2 text-sm text-ink focus:border-gold/55 focus:outline-none"
        />
        <button
          type="submit"
          disabled={creating}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-cream-50 transition hover:bg-ink-soft disabled:opacity-50"
        >
          {creating ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={13} strokeWidth={2} className="text-gold" />
          )}
          <span>{t("adminProps.smartLinks.create")}</span>
        </button>
      </form>
      {error && (
        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50/85 px-3 py-2 text-[12px] text-rose-700">
          {t("adminProps.smartLinks.error", { error })}
        </p>
      )}

      {/* Tabla de links */}
      {initialLinks.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-gold/25 bg-white/40 px-4 py-8 text-center text-[12px] text-ink/55">
          {t("adminProps.smartLinks.empty")}
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {initialLinks.map((link) => (
            <LinkRow key={link.id} link={link} slug={slug} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkRow({ link, slug }: { link: SmartLinkRow; slug: string }) {
  const t = useT();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/c/${link.token}`
      : `/c/${link.token}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t("adminProps.detail.copyLinkFallback"), url);
    }
  };

  const handleDelete = () => {
    if (!confirm(t("adminProps.smartLinks.confirmDelete"))) return;
    startTransition(async () => {
      const res = await deleteShareLink(link.id, slug);
      if (res.ok) router.refresh();
    });
  };

  const lastOpenedMin = minutesSince(link.last_opened_at);

  return (
    <li className="rounded-xl border border-ink/5 bg-white/65 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            {link.label || t("adminProps.smartLinks.unlabeled")}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-ink/55">
            /c/{link.token}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-md border border-gold/15 bg-gold/5 px-2 py-1 text-ink/75">
            <BarChart3 size={11} strokeWidth={2} className="text-gold-dark" />
            <span>
              {t("adminProps.smartLinks.opens", { n: link.opens_count })}
            </span>
          </span>
          {lastOpenedMin != null && (
            <span className="text-ink/55">
              {formatRelativeMinutes(lastOpenedMin, t)}
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition",
            copied
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-ink/15 bg-white text-ink/75 hover:border-gold/55 hover:text-ink",
          )}
        >
          {copied ? (
            <Check size={13} strokeWidth={2} />
          ) : (
            <Copy size={13} strokeWidth={1.75} className="text-gold-dark" />
          )}
          <span>
            {copied
              ? t("adminProps.smartLinks.copied")
              : t("adminProps.smartLinks.copy")}
          </span>
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-ink/15 bg-white px-3 text-[12px] font-medium text-ink/75 transition hover:border-gold/55 hover:text-ink"
          title={t("adminProps.smartLinks.open")}
        >
          <Link2 size={13} strokeWidth={1.75} className="text-gold-dark" />
        </a>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-ink/15 bg-white px-3 text-ink/55 transition hover:border-rose-300/60 hover:text-rose-600 disabled:opacity-50"
          title={t("adminProps.smartLinks.delete")}
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      </div>
    </li>
  );
}
