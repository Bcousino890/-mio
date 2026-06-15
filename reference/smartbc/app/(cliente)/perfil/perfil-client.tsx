"use client";

import {
  Building2,
  Check,
  Languages,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Sparkles,
  Tag,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateClientOwnPreferences,
  updateClientProfile,
} from "@/app/(cliente)/actions";
import { SectionHeader } from "@/components/section-header";
import { Modal } from "@/components/ui/modal";
import { PageFooter } from "@/components/ui/page-footer";
import { formatPrice } from "@/lib/format";
import { useT } from "@/lib/i18n/provider";
import { MADRID_ZONES } from "@/lib/mock-properties";
import type { ClientProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

const LANG_LABELS: Record<ClientProfile["preferredLanguage"], string> = {
  es: "Español",
  en: "English",
  fr: "Français",
  de: "Deutsch",
};

export function PerfilClient({ profile }: { profile: ClientProfile }) {
  const initials =
    `${profile.firstName[0] ?? ""}${profile.lastName[0] ?? ""}`.toUpperCase() ||
    "—";
  const [personalOpen, setPersonalOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-10 md:px-8">
      <SectionHeader titleKey="perfil.title" subtitleKey="perfil.subtitle" />

      <div className="mt-8 flex flex-col gap-5">
        <PersonalSection
          profile={profile}
          initials={initials}
          onEdit={() => setPersonalOpen(true)}
        />
        <PreferencesSection
          profile={profile}
          onEdit={() => setPrefsOpen(true)}
        />
        <ShopperSection profile={profile} />
      </div>

      <EditPersonalModal
        open={personalOpen}
        onClose={() => setPersonalOpen(false)}
        profile={profile}
      />
      <EditPreferencesModal
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        profile={profile}
      />

      <PageFooter textKey="login.footer" />
    </div>
  );
}

function PersonalSection({
  profile,
  initials,
  onEdit,
}: {
  profile: ClientProfile;
  initials: string;
  onEdit: () => void;
}) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.30)] backdrop-blur-sm md:p-6">
      <header className="flex items-center justify-between">
        <h2 className="font-serif text-2xl font-medium text-ink">
          {t("perfil.personal.title")}
        </h2>
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-2 rounded-lg border border-gold/30 bg-white/60 px-3 py-1.5 text-[12px] font-medium text-ink/70 transition hover:bg-white/85 hover:text-ink"
        >
          <Pencil size={13} strokeWidth={1.75} />
          <span>{t("perfil.personal.edit")}</span>
        </button>
      </header>

      <div className="mt-5 grid grid-cols-1 items-center gap-5 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-2">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-cream-100 font-serif text-xl font-medium text-ink">
            {initials}
          </span>
          <div className="text-center">
            <p className="font-serif text-lg font-medium text-ink">
              {profile.firstName} {profile.lastName}
            </p>
            <p className="text-[11px] text-ink/55">
              {t("perfil.personal.memberSince")}: {profile.memberSince}
            </p>
          </div>
        </div>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DetailRow
            icon={<Mail size={15} strokeWidth={1.75} />}
            label={t("perfil.personal.email")}
            value={profile.email}
          />
          <DetailRow
            icon={<Phone size={15} strokeWidth={1.75} />}
            label={t("perfil.personal.phone")}
            value={profile.phone || "—"}
          />
          <DetailRow
            icon={<Languages size={15} strokeWidth={1.75} />}
            label={t("perfil.personal.language")}
            value={LANG_LABELS[profile.preferredLanguage]}
          />
        </ul>
      </div>
    </section>
  );
}

function PreferencesSection({
  profile,
  onEdit,
}: {
  profile: ClientProfile;
  onEdit: () => void;
}) {
  const t = useT();
  const p = profile.preferences;
  return (
    <section className="rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.30)] backdrop-blur-sm md:p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl font-medium text-ink">
            {t("perfil.preferences.title")}
          </h2>
          <p className="mt-1 text-sm text-ink/60">
            {t("perfil.preferences.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-gold/30 bg-white/60 px-3 py-1.5 text-[12px] font-medium text-ink/70 transition hover:bg-white/85 hover:text-ink"
        >
          <Pencil size={13} strokeWidth={1.75} />
          <span>{t("perfil.preferences.edit")}</span>
        </button>
      </header>

      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {p.bedrooms !== undefined && (
          <DetailRow
            icon={<Building2 size={15} strokeWidth={1.75} />}
            label={t("perfil.preferences.bedrooms")}
            value={`${p.bedrooms}+`}
          />
        )}
        {p.budgetMin !== undefined && p.budgetMax !== undefined && (
          <DetailRow
            icon={<Sparkles size={15} strokeWidth={1.75} />}
            label={t("perfil.preferences.budget")}
            value={t("perfil.preferences.budget.range", {
              min: formatPrice(p.budgetMin),
              max: formatPrice(p.budgetMax),
            })}
          />
        )}
        {p.stayType && (
          <DetailRow
            label={t("perfil.preferences.stay")}
            value={t(
              `filters.stay.${p.stayType === "corta" ? "short" : "long"}`,
            )}
          />
        )}
        {p.operation && (
          <DetailRow
            label={t("perfil.preferences.operation")}
            value={t(
              `filters.operation.${p.operation === "alquiler" ? "rent" : "sale"}`,
            )}
          />
        )}
        {p.preferredZones.length > 0 && (
          <li className="rounded-xl border border-gold/15 bg-white/60 p-3 sm:col-span-2 lg:col-span-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink/55">
              {t("perfil.preferences.zones")}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.preferredZones.map((zone) => (
                <span
                  key={zone}
                  className="rounded-md bg-cream-100/80 px-2.5 py-1 text-xs font-medium text-ink/75"
                >
                  {zone}
                </span>
              ))}
            </div>
          </li>
        )}
      </ul>
    </section>
  );
}

function ShopperSection({ profile }: { profile: ClientProfile }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-gold/30 bg-cream-100/60 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.30)] backdrop-blur-sm md:p-6">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gold/50 text-gold">
          <Tag size={18} strokeWidth={1.5} />
        </span>
        <div>
          <h2 className="font-serif text-xl font-medium text-ink">
            {t("perfil.shopper.title")}
          </h2>
          <p className="mt-1 text-sm text-ink/60">
            {t("perfil.shopper.subtitle")}
          </p>
        </div>
      </header>

      {profile.shopperTagKeys.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {profile.shopperTagKeys.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-gold/40 bg-white/80 px-3 py-1.5 text-xs font-medium text-ink"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink/55">
          {t("perfil.shopper.empty")}
        </p>
      )}
    </section>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-gold/15 bg-white/60 p-3">
      {icon && (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink/55">
          {label}
        </p>
        <p className="mt-0.5 truncate text-sm font-medium text-ink">{value}</p>
      </div>
    </li>
  );
}

function EditPersonalModal({
  open,
  onClose,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  profile: ClientProfile;
}) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [phone, setPhone] = useState(profile.phone);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFirstName(profile.firstName);
      setLastName(profile.lastName);
      setPhone(profile.phone);
      setError(null);
    }
  }, [open, profile]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateClientProfile({
        firstName,
        lastName,
        phone: phone || undefined,
      });
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      isPending={isPending}
      title={t("perfil.editPersonal.title")}
    >
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("perfil.editPersonal.firstName")}>
            <TextInput value={firstName} onChange={setFirstName} />
          </Field>
          <Field label={t("perfil.editPersonal.lastName")}>
            <TextInput value={lastName} onChange={setLastName} />
          </Field>
          <Field label={t("perfil.editPersonal.phone")} wide>
            <TextInput value={phone} onChange={setPhone} type="tel" />
          </Field>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
            {error}
          </p>
        )}

        <ModalFooter
          onClose={onClose}
          isPending={isPending}
          submitLabel={t("perfil.editPersonal.save")}
          savingLabel={t("perfil.editPersonal.saving")}
        />
      </form>
    </Modal>
  );
}

function EditPreferencesModal({
  open,
  onClose,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  profile: ClientProfile;
}) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const p = profile.preferences;
  const [operation, setOperation] = useState(p.operation ?? "alquiler");
  const [stayType, setStayType] = useState(p.stayType ?? "larga");
  const [bedrooms, setBedrooms] = useState(p.bedrooms ?? 1);
  const [budgetMin, setBudgetMin] = useState(p.budgetMin ?? 0);
  const [budgetMax, setBudgetMax] = useState(p.budgetMax ?? 0);
  const [zones, setZones] = useState<string[]>(p.preferredZones);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setOperation(p.operation ?? "alquiler");
      setStayType(p.stayType ?? "larga");
      setBedrooms(p.bedrooms ?? 1);
      setBudgetMin(p.budgetMin ?? 0);
      setBudgetMax(p.budgetMax ?? 0);
      setZones(p.preferredZones);
      setError(null);
    }
  }, [open, p]);

  if (!open) return null;

  const toggleZone = (zone: string) => {
    setZones((curr) =>
      curr.includes(zone) ? curr.filter((z) => z !== zone) : [...curr, zone],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateClientOwnPreferences({
        operation,
        stayType,
        bedrooms: bedrooms || undefined,
        budgetMin: budgetMin || undefined,
        budgetMax: budgetMax || undefined,
        preferredZones: zones,
      });
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      isPending={isPending}
      title={t("perfil.editPrefs.title")}
    >
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("filters.operation.label")}>
            <select
              value={operation}
              onChange={(e) => setOperation(e.target.value as "alquiler" | "venta")}
              className="w-full appearance-none rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[13px] text-ink focus:border-gold/55 focus:outline-none"
            >
              <option value="alquiler">{t("filters.operation.rent")}</option>
              <option value="venta">{t("filters.operation.sale")}</option>
            </select>
          </Field>
          <Field label={t("filters.stay.label")}>
            <select
              value={stayType}
              onChange={(e) => setStayType(e.target.value as "corta" | "larga")}
              className="w-full appearance-none rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[13px] text-ink focus:border-gold/55 focus:outline-none"
            >
              <option value="larga">{t("filters.stay.long")}</option>
              <option value="corta">{t("filters.stay.short")}</option>
            </select>
          </Field>
          <Field label={t("perfil.preferences.bedrooms")}>
            <NumberInput value={bedrooms} onChange={setBedrooms} min={0} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("perfil.editPrefs.budgetMin")}>
              <NumberInput value={budgetMin} onChange={setBudgetMin} min={0} />
            </Field>
            <Field label={t("perfil.editPrefs.budgetMax")}>
              <NumberInput value={budgetMax} onChange={setBudgetMax} min={0} />
            </Field>
          </div>
        </div>

        <fieldset className="mt-4">
          <legend className="text-[12px] font-medium text-ink/65">
            {t("perfil.preferences.zones")}
          </legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MADRID_ZONES.map((zone) => {
              const active = zones.includes(zone);
              return (
                <button
                  key={zone}
                  type="button"
                  onClick={() => toggleZone(zone)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition",
                    active
                      ? "bg-ink text-cream-50"
                      : "bg-cream-100/80 text-ink/65 hover:bg-cream-100",
                  )}
                >
                  {zone}
                </button>
              );
            })}
          </div>
        </fieldset>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
            {error}
          </p>
        )}

        <ModalFooter
          onClose={onClose}
          isPending={isPending}
          submitLabel={t("perfil.editPrefs.save")}
          savingLabel={t("perfil.editPrefs.saving")}
        />
      </form>
    </Modal>
  );
}

function ModalFooter({
  onClose,
  isPending,
  submitLabel,
  savingLabel,
}: {
  onClose: () => void;
  isPending: boolean;
  submitLabel: string;
  savingLabel: string;
}) {
  const t = useT();
  return (
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
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-cream-50 transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? (
          <Loader2
            size={14}
            strokeWidth={1.75}
            className="animate-spin text-gold"
          />
        ) : (
          <Check size={14} strokeWidth={1.75} className="text-gold" />
        )}
        <span>{isPending ? savingLabel : submitLabel}</span>
      </button>
    </footer>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label
      className={cn("block text-[12px] font-medium text-ink/65", wide && "sm:col-span-2")}
    >
      <span>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function TextInput({
  value,
  onChange,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[13px] text-ink focus:border-gold/55 focus:outline-none"
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <input
      type="number"
      min={min}
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        onChange(Number.isFinite(n) ? n : 0);
      }}
      className="w-full rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[13px] text-ink focus:border-gold/55 focus:outline-none"
    />
  );
}
