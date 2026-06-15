"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAgency } from "@/app/(admin)/admin/agencias/actions";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

type Feedback = { kind: "idle" } | { kind: "error"; msg: string };

const RENT_THRESHOLDS = [0, 1000, 1500, 1800, 2200, 2500, 3000, 3500, 4000, 5000];
const SALE_AGREED_OPTIONS = [0, 1, 2, 3, 4, 5, 6];

export function NewAgencyModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });

  // Form state — un solo objeto para simplicidad.
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [website, setWebsite] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [rentMinPrice, setRentMinPrice] = useState(0);
  const [saleAgreedPct, setSaleAgreedPct] = useState(0);
  const [agreementSignedAt, setAgreementSignedAt] = useState("");

  // Auto-derivar slug del nombre mientras no lo edite el admin manualmente.
  useEffect(() => {
    if (!slugTouched) {
      setSlug(autoSlug(name));
    }
  }, [name, slugTouched]);

  // Resetear al cerrar.
  useEffect(() => {
    if (!open) {
      setName("");
      setSlug("");
      setSlugTouched(false);
      setWebsite("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setRentMinPrice(0);
      setSaleAgreedPct(0);
      setAgreementSignedAt("");
      setFeedback({ kind: "idle" });
    }
  }, [open]);

  const canSubmit = name.trim().length > 0 && !isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setFeedback({ kind: "idle" });

    startTransition(async () => {
      const result = await createAgency({
        name: name.trim(),
        slug: slug.trim(),
        website: website.trim() || undefined,
        contactName: contactName.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        rentCommissionPct: 50, // por defecto 50% (el patrón Level)
        saleAgreedCommissionPct: saleAgreedPct || undefined,
        rentCommissionMinPrice: rentMinPrice || undefined,
        agreementSignedAt: agreementSignedAt || undefined,
      });
      if (result.ok) {
        onClose();
        router.push(`/admin/agencias/${result.slug}`);
      } else {
        setFeedback({
          kind: "error",
          msg: humanError(t, result.error),
        });
      }
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      isPending={isPending}
      size="2xl"
      title={t("agencias.new.title")}
      subtitle={t("agencias.new.subtitle")}
    >
      <form onSubmit={handleSubmit}>
        <Section title={t("agencias.new.section.basic")}>
          <Field label={t("agencias.new.field.name")} required>
            <TextInput value={name} onChange={setName} autoFocus />
          </Field>
          <Field
            label={t("agencias.new.field.slug")}
            help={t("agencias.new.field.slug.help")}
          >
            <TextInput
              value={slug}
              onChange={(v) => {
                setSlug(v);
                setSlugTouched(true);
              }}
              placeholder="level"
            />
          </Field>
          <Field label={t("agencias.new.field.website")}>
            <TextInput
              value={website}
              onChange={setWebsite}
              placeholder="https://…"
              type="url"
            />
          </Field>
          <Field label={t("agencias.new.field.agreementDate")}>
            <input
              type="date"
              value={agreementSignedAt}
              onChange={(e) => setAgreementSignedAt(e.target.value)}
              className="w-full rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[13px] text-ink focus:border-gold/55 focus:outline-none"
            />
          </Field>
        </Section>

        <Section title={t("agencias.new.section.contact")}>
          <Field label={t("agencias.new.field.contactName")}>
            <TextInput value={contactName} onChange={setContactName} />
          </Field>
          <Field label={t("agencias.new.field.contactEmail")}>
            <TextInput
              value={contactEmail}
              onChange={setContactEmail}
              type="email"
            />
          </Field>
          <Field label={t("agencias.new.field.contactPhone")}>
            <TextInput
              value={contactPhone}
              onChange={setContactPhone}
              type="tel"
              placeholder="+34 …"
            />
          </Field>
        </Section>

        <Section title={t("agencias.new.section.commissions")}>
          <Field
            label={t("agencias.new.field.rentMinPrice")}
            help={t("agencias.new.field.rentMinPrice.help")}
          >
            <select
              value={rentMinPrice}
              onChange={(e) => setRentMinPrice(Number(e.target.value))}
              className="w-full appearance-none rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[13px] text-ink focus:border-gold/55 focus:outline-none"
            >
              {RENT_THRESHOLDS.map((v) => (
                <option key={v} value={v}>
                  {v <= 0 ? t("agency.stats.minPrice.notSet") : `${v} € / mes`}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t("agencias.new.field.saleAgreed")}
            help={t("agencias.new.field.saleAgreed.help")}
          >
            <select
              value={saleAgreedPct}
              onChange={(e) => setSaleAgreedPct(Number(e.target.value))}
              className="w-full appearance-none rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[13px] text-ink focus:border-gold/55 focus:outline-none"
            >
              {SALE_AGREED_OPTIONS.map((v) =>
                v <= 0 ? (
                  <option key={v} value={v}>
                    {t("agency.stats.agreedSale.notSet")}
                  </option>
                ) : (
                  <option key={v} value={v}>
                    {v}% → {v / 2}%
                  </option>
                ),
              )}
            </select>
          </Field>
        </Section>

        {feedback.kind === "error" && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
            {feedback.msg}
          </p>
        )}

        <footer className="mt-6 flex items-center justify-end gap-2.5 border-t border-gold/15 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-[13px] font-medium text-ink/70 transition hover:border-ink/30 hover:text-ink disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-cream-50 transition",
              "hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isPending ? (
              <Loader2 size={14} strokeWidth={1.75} className="animate-spin text-gold" />
            ) : (
              <Check size={14} strokeWidth={1.75} className="text-gold" />
            )}
            <span>
              {isPending ? t("agencias.new.creating") : t("agencias.new.create")}
            </span>
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function autoSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function humanError(
  t: (key: string) => string,
  code: string,
): string {
  const known: Record<string, string> = {
    name_required: t("agencias.new.error.nameRequired"),
    slug_required: t("agencias.new.error.slugRequired"),
    slug_duplicate: t("agencias.new.error.slugDuplicate"),
    forbidden_not_admin: t("agencias.new.error.forbidden"),
    no_session: t("agencias.new.error.noSession"),
  };
  return known[code] ?? `${t("agencias.new.error.generic")} · ${code}`;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45">
        {title}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  required,
  help,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  help?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="block text-[12px] font-medium text-ink/65">
      <span>
        {label}
        {required && <span className="ml-1 text-gold-dark">*</span>}
      </span>
      <div className="mt-1">
        {/* Inputs son textareas/inputs propios; el id real lo lleva el input nativo si lo usásemos */}
        {children}
      </div>
      {help && <p className="mt-1 text-[11px] text-ink/45">{help}</p>}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      // biome-ignore lint/a11y/noAutofocus: campo principal del modal
      autoFocus={autoFocus}
      className="w-full rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[13px] text-ink placeholder:text-ink/35 focus:border-gold/55 focus:outline-none"
    />
  );
}
