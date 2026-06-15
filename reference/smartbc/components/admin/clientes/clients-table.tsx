"use client";

import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/provider";
import type { AdminClient, ClientProfileType, ClientStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const PROFILE_KEYS: Record<ClientProfileType, string> = {
  student: "clientes.profile.student",
  worker: "clientes.profile.worker",
  company: "clientes.profile.company",
};

type StatusFilter = "all" | ClientStatus;
type SortKey = "recent" | "name" | "favorites" | "visits";

const PAGE_SIZE = 8;

export function ClientsTable({
  clients,
  totalClients,
  selectedId,
  onSelect,
}: {
  clients: AdminClient[];
  totalClients: number;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("recent");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = clients;

    // Filtro por búsqueda
    if (q) {
      result = result.filter(
        (c) =>
          `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.preferredZone.toLowerCase().includes(q),
      );
    }

    // Filtro por estado
    if (statusFilter !== "all") {
      result = result.filter((c) => c.status === statusFilter);
    }

    // Ordenación
    const sorted = [...result];
    if (sortKey === "name") {
      sorted.sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      );
    } else if (sortKey === "favorites") {
      sorted.sort((a, b) => b.activity.favorites - a.activity.favorites);
    } else if (sortKey === "visits") {
      sorted.sort((a, b) => b.activity.visitsRequested - a.activity.visitsRequested);
    }
    // "recent" mantiene el orden original (por created_at desc desde la BD)

    return sorted;
  }, [clients, query, statusFilter, sortKey]);

  const totalPages = Math.max(1, Math.ceil(totalClients / PAGE_SIZE));
  const visibleFrom = filtered.length === 0 ? 0 : 1;
  const visibleTo = Math.min(filtered.length, PAGE_SIZE);

  const STATUS_TABS: { value: StatusFilter; labelKey: string }[] = [
    { value: "all", labelKey: "clientes.filter.all" },
    { value: "active", labelKey: "clientes.filter.active" },
    { value: "inactive", labelKey: "clientes.filter.inactive" },
  ];

  return (
    <section className="flex flex-col rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-6">
      {/* Top: search + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex w-full max-w-sm items-center gap-2 rounded-xl border border-ink/10 bg-white/85 px-3 py-2 text-sm transition focus-within:border-gold/55">
          <Search size={15} strokeWidth={1.75} className="text-ink/45" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("clientes.search.placeholder")}
            className="w-full bg-transparent text-ink placeholder:text-ink/40 focus:outline-none"
          />
        </label>

        <div className="flex items-center gap-2">
          {/* Tabs de estado */}
          <div className="flex rounded-lg border border-ink/10 bg-white/70 p-0.5">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] font-medium transition",
                  statusFilter === tab.value
                    ? "bg-ink text-cream-50 shadow-sm"
                    : "text-ink/60 hover:text-ink",
                )}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>

          {/* Selector de ordenación */}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="appearance-none rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[12px] font-medium text-ink/70 transition hover:border-gold/40 focus:border-gold/55 focus:outline-none"
          >
            <option value="recent">{t("clientes.sort.recent")}</option>
            <option value="name">{t("clientes.sort.name")}</option>
            <option value="favorites">{t("clientes.sort.favorites")}</option>
            <option value="visits">{t("clientes.sort.visits")}</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="mt-5 flex-1 overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-y-1.5 text-left text-sm">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
              <th className="px-3 pb-2">{t("clientes.table.client")}</th>
              <th className="px-3 pb-2">{t("clientes.table.profile")}</th>
              <th className="px-3 pb-2">{t("clientes.table.operation")}</th>
              <th className="px-3 pb-2">{t("clientes.table.preferences")}</th>
              <th className="px-3 pb-2">{t("clientes.table.lastAccess")}</th>
              <th className="px-3 pb-2">{t("clientes.table.status")}</th>
              <th className="px-3 pb-2">{t("clientes.table.advisor")}</th>
              <th className="px-3 pb-2 text-right">
                {t("clientes.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="rounded-xl border border-gold/15 bg-white/40 px-4 py-10 text-center text-ink/55"
                >
                  {t("clientes.empty")}
                </td>
              </tr>
            ) : (
              filtered.map((client) => (
                <ClientRow
                  key={client.id}
                  client={client}
                  selected={client.id === selectedId}
                  onSelect={onSelect}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gold/15 pt-4 text-[12px]">
        <p className="text-ink/55">
          {t("clientes.pagination.showing", {
            from: visibleFrom,
            to: visibleTo,
            total: totalClients,
          })}
        </p>
        <Pagination totalPages={totalPages} currentPage={1} />
      </footer>
    </section>
  );
}

function ClientRow({
  client,
  selected,
  onSelect,
}: {
  client: AdminClient;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const isActive = client.status === "active";
  const fullName = `${client.firstName} ${client.lastName}`;

  return (
    <tr
      className={cn(
        "cursor-pointer text-[13px] transition",
        selected
          ? "bg-cream-100/80 ring-2 ring-gold/40"
          : "bg-white/55 hover:bg-white/85",
      )}
      onClick={() => onSelect(client.id)}
    >
      <td className="rounded-l-xl px-3 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink font-serif text-[10px] font-medium text-cream-50">
            {client.avatarInitials}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{fullName}</p>
            <p className="truncate text-[11px] text-ink/55">{client.email}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <span className="rounded-md border border-ink/10 bg-cream-100/80 px-2.5 py-1 text-[11px] font-medium text-ink/75">
          {t(PROFILE_KEYS[client.profileType])}
        </span>
      </td>
      <td className="px-3 py-3 text-ink/75">
        {t(
          `filters.operation.${client.operation === "alquiler" ? "rent" : "sale"}`,
        )}
      </td>
      <td className="px-3 py-3 text-ink/75">
        <p>{client.preferredZone}</p>
        <p className="text-[11px] text-ink/55">
          {t(`card.stay.${client.stayType === "corta" ? "short" : "long"}`)}
        </p>
      </td>
      <td className="px-3 py-3 text-[12px] text-ink/65">
        {client.lastAccessLabelKey
          ? t(client.lastAccessLabelKey, { time: client.lastAccessValue ?? "" })
          : (client.lastAccessText ?? "—")}
      </td>
      <td className="px-3 py-3">
        <span className="flex items-center gap-1.5 text-[12px] text-ink/75">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isActive ? "bg-emerald-500" : "bg-ink/30",
            )}
          />
          {t(`clientes.status.${client.status}`)}
        </span>
      </td>
      <td className="px-3 py-3 text-ink/75">{client.assignedAdvisor}</td>
      <td className="rounded-r-xl px-3 py-3 text-right">
        <Link
          href={`/admin/clientes/${client.id}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-1.5 text-[11px] font-medium text-cream-50 transition hover:bg-ink-soft"
        >
          <span>{t("clientes.table.viewDetails")}</span>
          <ArrowRight size={12} strokeWidth={1.75} className="text-gold" />
        </Link>
      </td>
    </tr>
  );
}

function Pagination({
  totalPages,
  currentPage,
}: {
  totalPages: number;
  currentPage: number;
}) {
  const pages: (number | "...")[] = [];
  if (totalPages <= 5) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1, 2, 3, "...", totalPages);
  }

  return (
    <nav className="flex items-center gap-1">
      <PageButton aria-label="Previous">
        <ChevronLeft size={14} strokeWidth={1.75} />
      </PageButton>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`gap-${i}`} className="px-2 text-ink/40">
            …
          </span>
        ) : (
          <PageButton key={p} active={p === currentPage}>
            {p}
          </PageButton>
        ),
      )}
      <PageButton aria-label="Next">
        <ChevronRight size={14} strokeWidth={1.75} />
      </PageButton>
    </nav>
  );
}

function PageButton({
  children,
  active = false,
  ...rest
}: {
  children: React.ReactNode;
  active?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-[12px] font-medium transition",
        active
          ? "bg-gold text-ink"
          : "border border-ink/10 bg-white/70 text-ink/65 hover:border-gold/40 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
