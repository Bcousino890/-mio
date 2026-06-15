"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CalendarClock, MessageSquare } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import type { NotificationItem } from "@/app/api/admin/notifications/route";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ayer";
  return `hace ${days}d`;
}

const ICON_MAP: Record<NotificationItem["type"], React.ReactNode> = {
  visit: (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold/10">
      <CalendarClock size={15} className="text-gold" strokeWidth={1.75} />
    </span>
  ),
  message: (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/8">
      <MessageSquare size={15} className="text-ink/65" strokeWidth={1.75} />
    </span>
  ),
};

export function NotificationsBell() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(Array.isArray(data) ? data : []);
      }
    } catch {
      // silently fail — non-critical
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch + polling every 60 s
  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(id);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const count = notifications.length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("admin.notifications")}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-ink/10 bg-white/70 text-ink/65 transition hover:border-gold/40 hover:text-ink"
      >
        <Bell size={16} strokeWidth={1.75} />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[360px] rounded-2xl border border-gold/15 bg-cream-50/95 shadow-xl backdrop-blur-sm">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gold/10 px-4 py-3">
            <span className="text-sm font-semibold text-ink">
              Notificaciones
            </span>
            <span className="text-[11px] text-ink/45">
              {count > 0 ? `${count} nueva${count !== 1 ? "s" : ""}` : "Al día"}
            </span>
          </div>

          {/* Body */}
          <div className="max-h-[380px] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                <Bell size={28} className="text-ink/20" strokeWidth={1.5} />
                <p className="text-sm font-medium text-ink/70">Todo al día</p>
                <p className="text-xs text-ink/40">
                  No hay notificaciones nuevas.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gold/8">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={n.href}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-3 px-4 py-3 transition hover:bg-gold/5"
                    >
                      {ICON_MAP[n.type]}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-ink">
                          {n.title}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[12px] text-ink/55">
                          {n.subtitle}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-ink/35">
                        {timeAgo(n.created_at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
