"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useT } from "@/lib/i18n/provider";
import type { Message } from "@/lib/types";

export function RecentMessagesBlock({ messages }: { messages: Message[] }) {
  const t = useT();

  return (
    <section className="flex flex-col rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.30)] backdrop-blur-sm md:p-6">
      <header className="flex items-center justify-between">
        <h2 className="font-serif text-xl font-medium text-ink">
          {t("inicio.messages.title")}
        </h2>
        <Link
          href="/mensajes"
          className="flex items-center gap-1.5 text-[12px] font-medium text-gold-dark transition hover:text-gold"
        >
          <span>{t("inicio.messages.viewAll")}</span>
          <ArrowRight size={13} strokeWidth={1.75} />
        </Link>
      </header>

      <ul className="mt-4 flex-1 space-y-3">
        {messages.map((m) => (
          <li
            key={m.id}
            className="flex items-start gap-3 border-b border-gold/10 pb-3 last:border-b-0 last:pb-0"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream-100 font-serif text-xs font-medium text-ink">
              {m.sender.initials ??
                m.sender.name
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-[13px] font-semibold text-ink">
                  {m.sender.name}
                </p>
                <p className="shrink-0 text-[11px] text-ink/55">
                  {m.timestampLabelKey
                    ? t(m.timestampLabelKey, { time: m.timestamp ?? "" })
                    : (m.timestamp ?? "")}
                </p>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink/70">
                {m.preview}
              </p>
            </div>
            {m.unread && (
              <span
                aria-label="unread"
                className="mt-2 h-2 w-2 shrink-0 rounded-full bg-gold"
              />
            )}
          </li>
        ))}
      </ul>

      <Link
        href="/mensajes"
        className="mt-4 flex items-center justify-center rounded-xl border border-gold/30 py-2.5 text-[12px] font-medium text-ink/70 transition hover:bg-white/60 hover:text-ink"
      >
        {t("inicio.messages.goTo")}
      </Link>
    </section>
  );
}
