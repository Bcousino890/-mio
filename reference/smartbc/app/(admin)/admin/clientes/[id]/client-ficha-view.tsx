"use client";

import {
  ArrowLeft,
  Bell,
  Calendar,
  Check,
  Clock,
  Eye,
  Heart,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Send,
  Star,
  X,
} from "lucide-react";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PageFooter } from "@/components/ui/page-footer";
import { useT } from "@/lib/i18n/provider";
import type { AdminClient } from "@/lib/types";
import { cn } from "@/lib/utils";

type RawVisit = {
  id: string;
  property_id: string;
  requested_at: string;
  status: string;
  propertyTitle: string | null;
  propertySlug: string | null;
};

type FavoriteRef = {
  id: string;
  slug: string | null;
  title: string | null;
};

const VISIT_DATE_FMT = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

// Intl.format(new Date(x)) lanza RangeError con fechas inválidas — parseo seguro.
function formatVisitDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : VISIT_DATE_FMT.format(d);
}

const VISIT_STATUS_STYLES: Record<
  string,
  { className: string; icon: React.ReactNode }
> = {
  pending: {
    className: "border-amber-200 bg-amber-50 text-amber-700",
    icon: <Clock size={11} strokeWidth={2} />,
  },
  confirmed: {
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: <Check size={11} strokeWidth={2} />,
  },
  completed: {
    className: "border-blue-200 bg-blue-50 text-blue-700",
    icon: <Check size={11} strokeWidth={2} />,
  },
  cancelled: {
    className: "border-ink/15 bg-ink/5 text-ink/55",
    icon: <X size={11} strokeWidth={2} />,
  },
};

export function ClientFichaView({
  client,
  favorites,
  visits,
}: {
  client: AdminClient;
  favorites: FavoriteRef[];
  visits: RawVisit[];
}) {
  const t = useT();
  const isActive = client.status === "active";
  const fullName = `${client.firstName} ${client.lastName}`;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1200px] flex-col px-6 pb-10 lg:px-10">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 pt-7 md:pt-9">
        <Link
          href="/admin/clientes"
          className="inline-flex items-center gap-2 text-sm text-ink/65 transition hover:text-ink"
        >
          <ArrowLeft size={15} strokeWidth={1.75} className="text-gold" />
          <span>{t("clientes.ficha.back")}</span>
        </Link>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={t("admin.notifications")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-ink/10 bg-white/70 text-ink/65 transition hover:border-gold/40 hover:text-ink"
          >
            <Bell size={16} strokeWidth={1.75} />
          </button>
          <LanguageSwitcher />
        </div>
      </div>

      {/* Header card */}
      <section className="mt-5 rounded-2xl border border-gold/15 bg-cream-50/85 p-6 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-5">
            {/* Avatar grande */}
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-ink font-serif text-2xl font-medium text-cream-50 shadow-lg">
              {client.avatarInitials}
            </div>
            <div>
              <h1 className="font-serif text-2xl font-semibold text-ink md:text-3xl">
                {fullName}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {/* Badge estado */}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                    isActive
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-ink/15 bg-ink/5 text-ink/55",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      isActive ? "bg-emerald-500" : "bg-ink/30",
                    )}
                  />
                  {t(`clientes.status.${client.status}`)}
                </span>
                {/* Badge perfil */}
                <span className="rounded-full border border-ink/10 bg-cream-100/80 px-2.5 py-0.5 text-[11px] font-medium text-ink/75">
                  {t(`clientes.profile.${client.profileType}`)}
                </span>
                {/* Badge prioridad */}
                {client.priority === "high" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
                    <Star size={10} className="fill-amber-500 text-amber-500" />
                    {t("clientes.detail.notes.priority.high")}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Botón enviar mensaje */}
          <Link
            href="/admin/mensajes"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-sm font-medium text-cream-50 transition hover:bg-ink-soft"
          >
            <Send size={14} strokeWidth={1.75} className="text-gold" />
            <span>{t("clientes.ficha.sendMessage")}</span>
          </Link>
        </div>

        {/* Contacto */}
        <div className="mt-5 border-t border-gold/15 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
            {t("clientes.ficha.contact.title")}
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink/70">
            <li className="flex items-center gap-2">
              <Mail size={14} strokeWidth={1.75} className="text-gold" />
              <a
                href={`mailto:${client.email}`}
                className="hover:text-ink hover:underline"
              >
                {client.email}
              </a>
            </li>
            {client.phone && (
              <li className="flex items-center gap-2">
                <Phone size={14} strokeWidth={1.75} className="text-gold" />
                <a
                  href={`tel:${client.phone}`}
                  className="hover:text-ink hover:underline"
                >
                  {client.phone}
                </a>
              </li>
            )}
            {client.location && (
              <li className="flex items-center gap-2">
                <MapPin size={14} strokeWidth={1.75} className="text-gold" />
                <span>{client.location}</span>
              </li>
            )}
          </ul>
        </div>
      </section>

      {/* Stats de actividad */}
      <section className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <ActivityCard
          icon={<Eye size={18} strokeWidth={1.75} />}
          value={client.activity.propertiesViewed}
          labelKey="clientes.detail.activity.viewed"
        />
        <ActivityCard
          icon={<Heart size={18} strokeWidth={1.75} />}
          value={client.activity.favorites}
          labelKey="clientes.detail.activity.favorites"
        />
        <ActivityCard
          icon={<Calendar size={18} strokeWidth={1.75} />}
          value={client.activity.visitsRequested}
          labelKey="clientes.detail.activity.visits"
        />
        <ActivityCard
          icon={<MessageSquare size={18} strokeWidth={1.75} />}
          value={client.activity.messages}
          labelKey="clientes.detail.activity.messages"
        />
      </section>

      {/* Grid: preferencias + notas | favoritas + visitas */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.4fr]">
        {/* Columna izquierda */}
        <div className="flex flex-col gap-5">
          <PreferencesCard client={client} />
          <NotesCard client={client} />
        </div>

        {/* Columna derecha */}
        <div className="flex flex-col gap-5">
          <FavoritesCard favorites={favorites} />
          <VisitsCard visits={visits} />
        </div>
      </div>

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}

function ActivityCard({
  icon,
  value,
  labelKey,
}: {
  icon: React.ReactNode;
  value: number | string;
  labelKey: string;
}) {
  const t = useT();
  return (
    <article className="flex items-center gap-4 rounded-2xl border border-gold/15 bg-cream-50/85 p-4 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
        {icon}
      </span>
      <div>
        <p className="font-serif text-2xl font-medium leading-none text-ink">
          {value}
        </p>
        <p className="mt-1 text-[11px] text-ink/55">{t(labelKey)}</p>
      </div>
    </article>
  );
}

function PreferencesCard({ client }: { client: AdminClient }) {
  const t = useT();
  const hasPrefs =
    client.preferredZone !== "—" ||
    client.budgetMin > 0 ||
    client.budgetMax > 0;

  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
        {t("clientes.ficha.preferences.title")}
      </h2>

      {!hasPrefs ? (
        <p className="mt-3 text-[13px] text-ink/55">
          {t("clientes.ficha.preferences.empty")}
        </p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <PrefItem
            label={t("clientes.ficha.preferences.operation")}
            value={t(
              `filters.operation.${client.operation === "alquiler" ? "rent" : "sale"}`,
            )}
          />
          <PrefItem
            label={t("clientes.ficha.preferences.stay")}
            value={t(
              `card.stay.${client.stayType === "corta" ? "short" : "long"}`,
            )}
          />
          <PrefItem
            label={t("clientes.ficha.preferences.zone")}
            value={client.preferredZone}
          />
          {(client.budgetMin > 0 || client.budgetMax > 0) && (
            <PrefItem
              label={t("clientes.ficha.preferences.budget")}
              value={`€${client.budgetMin.toLocaleString("es-ES")} – €${client.budgetMax.toLocaleString("es-ES")}`}
            />
          )}
          <PrefItem
            label={t("clientes.ficha.preferences.occupants")}
            value={String(client.occupants)}
          />
          <PrefItem
            label={t("clientes.ficha.preferences.pets")}
            value={client.pets
              ? t("clientes.detail.filters.pets.yes")
              : t("clientes.detail.filters.pets.no")}
          />
        </dl>
      )}
    </section>
  );
}

function PrefItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-ink/45">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}

function NotesCard({ client }: { client: AdminClient }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
        {t("clientes.ficha.notes.title")}
      </h2>
      <div className="mt-3 rounded-xl border border-gold/15 bg-white/55 p-3">
        {client.internalNotes.length === 0 ? (
          <p className="text-[12px] text-ink/55">
            {t("clientes.detail.notes.empty")}
          </p>
        ) : (
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink/75">
            {client.internalNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FavoritesCard({ favorites }: { favorites: FavoriteRef[] }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
          {t("clientes.ficha.favorites.title")}
        </h2>
        {favorites.length > 0 && (
          <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[11px] font-semibold text-gold-dark">
            {favorites.length}
          </span>
        )}
      </div>

      {favorites.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink/55">
          {t("clientes.ficha.favorites.empty")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {favorites.slice(0, 8).map((fav) => (
            <li
              key={fav.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-gold/10 bg-white/55 px-3 py-2.5 transition hover:border-gold/30 hover:bg-white/80"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold">
                  <Heart size={14} strokeWidth={1.75} />
                </span>
                <p className="truncate text-[13px] font-medium text-ink">
                  {fav.title ?? `${fav.id.slice(0, 20)}…`}
                </p>
              </div>
              {/* La ruta de admin usa slug; sin slug no hay link válido. */}
              {fav.slug && (
                <Link
                  href={`/admin/propiedades/${fav.slug}`}
                  className="shrink-0 text-[11px] font-medium text-gold-dark transition hover:text-gold hover:underline"
                >
                  {t("clientes.ficha.favorites.viewProperty")}
                </Link>
              )}
            </li>
          ))}
          {favorites.length > 8 && (
            <li className="pt-1 text-center text-[12px] text-ink/45">
              {t("clientes.ficha.moreCount", { count: favorites.length - 8 })}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function VisitsCard({ visits }: { visits: RawVisit[] }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
          {t("clientes.ficha.visits.title")}
        </h2>
        {visits.length > 0 && (
          <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[11px] font-semibold text-gold-dark">
            {visits.length}
          </span>
        )}
      </div>

      {visits.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink/55">
          {t("clientes.ficha.visits.empty")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {visits.slice(0, 10).map((visit) => {
            const statusStyle =
              VISIT_STATUS_STYLES[visit.status] ??
              VISIT_STATUS_STYLES.pending;
            return (
              <li
                key={visit.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-gold/10 bg-white/55 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold">
                    <Calendar size={14} strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    {visit.propertySlug ? (
                      <Link
                        href={`/admin/propiedades/${visit.propertySlug}`}
                        className="block truncate text-[12px] font-medium text-ink hover:underline"
                      >
                        {visit.propertyTitle ?? `${visit.property_id.slice(0, 20)}…`}
                      </Link>
                    ) : (
                      <p className="truncate text-[12px] font-medium text-ink">
                        {visit.propertyTitle ?? `${visit.property_id.slice(0, 20)}…`}
                      </p>
                    )}
                    <p className="text-[11px] text-ink/50">
                      {formatVisitDate(visit.requested_at)}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    statusStyle.className,
                  )}
                >
                  {statusStyle.icon}
                  {t(
                    `clientes.ficha.visits.status.${visit.status === "cancelled" ? "cancelled" : visit.status}`,
                  )}
                </span>
              </li>
            );
          })}
          {visits.length > 10 && (
            <li className="pt-1 text-center text-[12px] text-ink/45">
              {t("clientes.ficha.moreCount", { count: visits.length - 10 })}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
