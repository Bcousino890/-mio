"use client";

import { Loader2, Send } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { replyToConversation } from "@/app/(admin)/admin/mensajes/actions";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export type AdminConversation = {
  id: string;
  clientId: string;
  clientName: string;
  clientInitials: string;
  lastTimestamp: string | null;
  unreadCount: number;
  messages?: { id: string; body: string; fromClient: boolean; time: string }[];
};

export function AdminMensajesClient({
  conversations,
  activeId,
  messages,
}: {
  conversations: AdminConversation[];
  activeId: string | null;
  messages: NonNullable<AdminConversation["messages"]>;
}) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, activeId]);

  const selectConversation = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("c", id);
    router.push(`/admin/mensajes?${next.toString()}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    const body = draft.trim();
    if (!body) return;
    setError(null);
    setDraft("");
    startTransition(async () => {
      const result = await replyToConversation({
        conversationId: active.id,
        body,
      });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <section className="grid min-h-[640px] grid-cols-1 overflow-hidden rounded-2xl border border-gold/15 bg-cream-50/85 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:grid-cols-[320px_1fr] md:[height:640px]">
      <ConversationsList
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
      />

      <div className="flex min-h-[440px] flex-col bg-cream-50/40 md:min-h-0 md:border-l md:border-gold/15">
        {active ? (
          <>
            <header className="flex items-center gap-3 border-b border-gold/15 bg-cream-50/85 px-4 py-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-cream-100 font-serif text-xs font-medium text-ink">
                {active.clientInitials}
              </span>
              <p className="font-serif text-base font-semibold text-ink">
                {active.clientName}
              </p>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-sm text-ink/55">
                  {t("adminMensajes.thread.empty")}
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {messages.map((m, i) => (
                    <Bubble
                      key={m.id}
                      body={m.body}
                      fromClient={m.fromClient}
                      time={m.time}
                      showTime={
                        i === messages.length - 1 ||
                        messages[i + 1].fromClient !== m.fromClient
                      }
                    />
                  ))}
                </ul>
              )}
            </div>

            {error && (
              <p className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
                {error}
              </p>
            )}

            <form
              onSubmit={handleSubmit}
              className="flex items-center gap-2 border-t border-gold/15 bg-cream-50/85 p-3"
            >
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("adminMensajes.input.placeholder")}
                className="flex-1 rounded-lg border border-gold/25 bg-white/80 px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-gold/55 focus:outline-none"
              />
              <button
                type="submit"
                disabled={draft.trim().length === 0 || isPending}
                className="flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-cream-50 transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2
                    size={14}
                    strokeWidth={1.75}
                    className="animate-spin text-gold"
                  />
                ) : (
                  <Send size={14} strokeWidth={1.75} className="text-gold" />
                )}
                <span>{t("adminMensajes.input.send")}</span>
              </button>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="text-sm text-ink/55">{t("adminMensajes.empty")}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function ConversationsList({
  conversations,
  activeId,
  onSelect,
}: {
  conversations: AdminConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  if (conversations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink/55">
        {t("adminMensajes.list.empty")}
      </div>
    );
  }
  return (
    <ul className="flex flex-col overflow-y-auto md:max-h-full">
      <li className="border-b border-gold/15 px-4 py-3">
        <p className="font-serif text-sm font-semibold text-ink">
          {t("adminMensajes.list.title")}
        </p>
      </li>
      {conversations.map((c) => {
        const active = c.id === activeId;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className={cn(
                "flex w-full items-start gap-3 border-b border-gold/10 px-4 py-3 text-left transition hover:bg-white/55",
                active && "bg-white/75",
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream-100 font-serif text-xs font-medium text-ink">
                {c.clientInitials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[13px] font-semibold text-ink">
                    {c.clientName}
                  </p>
                  {c.lastTimestamp && (
                    <p className="shrink-0 text-[10px] text-ink/55">
                      {formatRelative(c.lastTimestamp)}
                    </p>
                  )}
                </div>
              </div>
              {c.unreadCount > 0 && (
                <span className="mt-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-[10px] font-semibold text-ink">
                  {c.unreadCount}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Bubble({
  body,
  fromClient,
  time,
  showTime,
}: {
  body: string;
  fromClient: boolean;
  time: string;
  showTime: boolean;
}) {
  return (
    <li
      className={cn("flex flex-col", fromClient ? "items-start" : "items-end")}
    >
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm",
          fromClient
            ? "rounded-bl-md bg-white text-ink"
            : "rounded-br-md bg-ink text-cream-50",
        )}
      >
        {body}
      </div>
      {showTime && (
        <span
          className={cn(
            "mt-0.5 text-[10px] text-ink/45",
            fromClient ? "pl-2" : "pr-2",
          )}
        >
          {time}
        </span>
      )}
    </li>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
