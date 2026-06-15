"use client";

import { Clock, Mail, MessageCircle, Phone } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import type { PropertyContact } from "@/lib/types";

export function PropertyContactBlock({
  contact,
}: {
  contact: PropertyContact;
}) {
  const t = useT();
  const whatsappHref = contact.whatsapp
    ? `https://wa.me/${contact.whatsapp.replace(/[^0-9]/g, "")}`
    : undefined;

  return (
    <section className="rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.35)] backdrop-blur-sm md:p-6">
      <h2 className="font-serif text-xl font-medium text-ink">
        {t("detail.contact.title")}
      </h2>
      <p className="mt-1 text-sm text-ink/60">{t("detail.contact.subtitle")}</p>

      <ul className="mt-4 space-y-3 text-sm">
        {contact.phone && (
          <ContactItem
            icon={<Phone size={15} strokeWidth={1.75} />}
            href={`tel:${contact.phone.replace(/\s+/g, "")}`}
            label={contact.phone}
          />
        )}
        {contact.email && (
          <ContactItem
            icon={<Mail size={15} strokeWidth={1.75} />}
            href={`mailto:${contact.email}`}
            label={contact.email}
          />
        )}
        {contact.hoursKey && (
          <ContactItem
            icon={<Clock size={15} strokeWidth={1.75} />}
            label={t(contact.hoursKey)}
          />
        )}
      </ul>

      {whatsappHref && (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-xl bg-ink py-3 text-sm font-medium text-cream-50 transition hover:bg-ink-soft"
        >
          <MessageCircle size={16} strokeWidth={1.75} className="text-gold" />
          <span>{t("detail.contact.whatsapp")}</span>
        </a>
      )}
    </section>
  );
}

function ContactItem({
  icon,
  href,
  label,
}: {
  icon: React.ReactNode;
  href?: string;
  label: string;
}) {
  const content = (
    <span className="flex items-center gap-2.5 text-ink/75">
      <span className="text-gold">{icon}</span>
      <span>{label}</span>
    </span>
  );
  if (!href) return <li>{content}</li>;
  return (
    <li>
      <a
        href={href}
        className="block transition hover:text-ink"
      >
        {content}
      </a>
    </li>
  );
}
