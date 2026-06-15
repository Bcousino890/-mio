"use client";

import { ArrowRight, Mail, MapPin, Phone, User } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import type { AgencyContact } from "@/lib/types";

export function AgencyContactCard({ contact }: { contact: AgencyContact }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-6">
      <header className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">
        <User size={13} strokeWidth={1.75} className="text-gold" />
        <span>{t("agency.contact.title")}</span>
      </header>

      <div className="mt-4 flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cream-100 font-serif text-xs font-medium text-ink">
          {contact.initials}
        </span>
        <div className="min-w-0">
          <p className="font-serif text-base font-semibold text-ink">
            {contact.name}
          </p>
          <p className="text-[12px] text-ink/60">{t(contact.roleKey)}</p>
        </div>
      </div>

      <ul className="mt-5 space-y-3 text-sm">
        {contact.phone && (
          <ContactRow
            icon={<Phone size={14} strokeWidth={1.75} />}
            href={`tel:${contact.phone.replace(/\s+/g, "")}`}
            label={contact.phone}
          />
        )}
        {contact.email && (
          <ContactRow
            icon={<Mail size={14} strokeWidth={1.75} />}
            href={`mailto:${contact.email}`}
            label={contact.email}
          />
        )}
        {contact.address && (
          <ContactRow
            icon={<MapPin size={14} strokeWidth={1.75} />}
            label={contact.address}
          />
        )}
      </ul>

      <button
        type="button"
        className="mt-5 flex w-full items-center justify-between rounded-xl border border-gold/30 bg-white/80 px-4 py-2.5 text-sm font-medium text-ink transition hover:border-gold/55 hover:bg-white"
      >
        <span>{t("agency.contact.viewProfile")}</span>
        <ArrowRight size={14} strokeWidth={1.75} className="text-gold" />
      </button>
    </section>
  );
}

function ContactRow({
  icon,
  label,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
}) {
  const inner = (
    <span className="flex items-start gap-2.5 text-ink/75">
      <span className="mt-0.5 text-gold">{icon}</span>
      <span className="break-words">{label}</span>
    </span>
  );
  if (!href) return <li>{inner}</li>;
  return (
    <li>
      <a href={href} className="block transition hover:text-ink">
        {inner}
      </a>
    </li>
  );
}
