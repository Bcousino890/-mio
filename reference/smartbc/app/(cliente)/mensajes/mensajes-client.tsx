"use client";

import { Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/app/(cliente)/actions";
import { SectionHeader } from "@/components/section-header";
import { PageFooter } from "@/components/ui/page-footer";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  body: string;
  fromMe: boolean;
  time: string;
};

export function MensajesClient({
  messages: initialMessages,
  hasConversation,
}: {
  messages: ThreadMessage[];
  hasConversation: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Optimistic: lista local que añadimos al enviar sin esperar el servidor.
  const [optimisticAdds, setOptimisticAdds] = useState<ThreadMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Cuando el server revalida y recargamos, descartamos optimisticAdds que ya
  // estén persistidos (por simplicidad limpiamos todos al cambiar initial).
  useEffect(() => {
    setOptimisticAdds([]);
  }, [initialMessages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [initialMessages.length, optimisticAdds.length]);

  const allMessages = [...initialMessages, ...optimisticAdds];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setError(null);

    const now = new Date();
    const tempId = `local-${now.getTime()}`;
    const optimistic: ThreadMessage = {
      id: tempId,
      body,
      fromMe: true,
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    };
    setOptimisticAdds((curr) => [...curr, optimistic]);
    setDraft("");

    startTransition(async () => {
      const result = await sendMessage({ body });
      if (result.ok) {
        router.refresh();
      } else {
        setOptimisticAdds((curr) => curr.filter((m) => m.id !== tempId));
        setError(result.error);
      }
    });
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-10 md:px-8">
      <SectionHeader titleKey="mensajes.title" subtitleKey="mensajes.subtitle" />

      <div className="mt-8 flex min-h-[540px] flex-col overflow-hidden rounded-2xl border border-gold/20 bg-cream-50/85 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.30)] backdrop-blur-sm md:[height:640px]">
        <header className="flex items-center gap-3 border-b border-gold/15 bg-cream-50/85 px-4 py-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-cream-100 font-serif text-xs font-medium text-ink">
            BC
          </span>
          <p className="font-serif text-base font-semibold text-ink">
            {t("messages.thread.title")}
          </p>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
          {allMessages.length === 0 ? (
            <EmptyThread hasConversation={hasConversation} />
          ) : (
            <ul className="flex flex-col gap-2">
              {allMessages.map((m, i) => (
                <ThreadBubble
                  key={m.id}
                  message={m}
                  showTime={
                    i === allMessages.length - 1 ||
                    allMessages[i + 1].fromMe !== m.fromMe
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
            placeholder={t("messages.input.placeholder")}
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
            <span>{t("messages.input.send")}</span>
          </button>
        </form>
      </div>

      <PageFooter textKey="login.footer" />
    </div>
  );
}

function ThreadBubble({
  message,
  showTime,
}: {
  message: ThreadMessage;
  showTime: boolean;
}) {
  return (
    <li
      className={cn(
        "flex flex-col",
        message.fromMe ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm",
          message.fromMe
            ? "rounded-br-md bg-ink text-cream-50"
            : "rounded-bl-md bg-white text-ink",
        )}
      >
        {message.body}
      </div>
      {showTime && (
        <span
          className={cn(
            "mt-0.5 text-[10px] text-ink/45",
            message.fromMe ? "pr-2" : "pl-2",
          )}
        >
          {message.time}
        </span>
      )}
    </li>
  );
}

function EmptyThread({ hasConversation }: { hasConversation: boolean }) {
  const t = useT();
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center text-center">
      <p className="font-serif text-lg text-ink">
        {t("messages.thread.empty.title")}
      </p>
      <p className="mt-1 max-w-xs text-sm text-ink/55">
        {hasConversation
          ? t("messages.thread.empty.text")
          : t("messages.thread.empty.firstMessage")}
      </p>
    </div>
  );
}
