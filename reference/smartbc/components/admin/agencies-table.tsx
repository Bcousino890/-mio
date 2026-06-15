"use client";

import {
  ArrowRight,
  Home,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/provider";
import type { Agency } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AgenciesTable({ agencies }: { agencies: Agency[] }) {
  const t = useT();
  const [query, setQuery] = useState("");

  const minLastUpdate = useMemo(
    () => Math.min(...agencies.map((a) => a.lastUpdateMinutes)),
    [agencies],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agencies;
    return agencies.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.city.toLowerCase().includes(q),
    );
  }, [agencies, query]);

  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/80 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.25)] backdrop-blur-sm md:p-6">
      {/* Search bar */}
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <label className="flex w-full max-w-sm items-center gap-2 rounded-xl border border-ink/10 bg-white/85 px-3 py-2 text-sm transition focus-within:border-gold/55">
          <Search size={15} strokeWidth={1.75} className="text-ink/45" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("agencias.search.placeholder")}
            className="w-full bg-transparent text-ink placeholder:text-ink/40 focus:outline-none"
          />
        </label>

        <p className="flex items-center gap-1.5 text-[12px] text-ink/55">
          <RefreshCw size={13} strokeWidth={1.75} className="text-gold" />
          <span>{t("admin.lastUpdate.label")}</span>
          <span>
            {t("admin.relativeTime.minutesAgo", { n: minLastUpdate })}
          </span>
        </p>
      </div>

      {/* Table */}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[820px] border-separate border-spacing-y-1.5 text-left text-sm">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
              <th className="px-4 pb-2">{t("agencias.table.agency")}</th>
              <th className="px-4 pb-2 text-center">
                {t("agencias.table.rent")}
              </th>
              <th className="px-4 pb-2 text-center">
                {t("agencias.table.sale")}
              </th>
              <th className="px-4 pb-2 text-center">
                {t("agencias.table.total")}
              </th>
              <th className="px-4 pb-2">{t("agencias.table.lastUpdate")}</th>
              <th className="px-4 pb-2 text-right">
                {t("agencias.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="rounded-xl border border-gold/15 bg-white/40 px-4 py-10 text-center text-ink/55"
                >
                  {t("agencias.search.noResults")}
                </td>
              </tr>
            ) : (
              filtered.map((agency) => (
                <AgencyRow key={agency.id} agency={agency} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AgencyRow({ agency }: { agency: Agency }) {
  const t = useT();
  const total = agency.rentCount + agency.saleCount;
  return (
    <tr className="bg-white/55 transition hover:bg-white/85">
      <td className="rounded-l-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink font-serif text-[11px] font-medium text-cream-50">
            {agency.initials}
          </span>
          <div>
            <p className="font-medium text-ink">{agency.name}</p>
            <p className="text-[11px] text-ink/55">{agency.city}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-center">
        <Inline icon={<Home size={14} strokeWidth={1.75} />} value={agency.rentCount} />
      </td>
      <td className="px-4 py-3 text-center">
        <Inline icon={<Tag size={13} strokeWidth={1.75} />} value={agency.saleCount} />
      </td>
      <td className="px-4 py-3 text-center font-semibold text-ink">{total}</td>
      <td className="px-4 py-3 text-[12px] text-ink/65">
        {t("admin.relativeTime.minutesAgo", { n: agency.lastUpdateMinutes })}
      </td>
      <td className="rounded-r-xl px-4 py-3 text-right">
        <Link
          href={`/admin/agencias/${agency.id}`}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-[12px] font-medium text-cream-50 transition",
            "hover:bg-ink-soft",
          )}
        >
          <span>{t("agencias.table.viewDetails")}</span>
          <ArrowRight size={13} strokeWidth={1.75} className="text-gold" />
        </Link>
      </td>
    </tr>
  );
}

function Inline({
  icon,
  value,
}: {
  icon: React.ReactNode;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-ink">
      <span className="text-gold">{icon}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
