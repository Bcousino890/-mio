"use client";

import {
  Bell,
  Building2,
  Check,
  Globe,
  Palette,
  Save,
  Sliders,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageFooter } from "@/components/ui/page-footer";
import { EmailConfigClient } from "./email-config-client";
import { LogsViewer } from "./logs-viewer";
import { MigrationsManager } from "./migrations-manager";
import { useT } from "@/lib/i18n/provider";
import { mockAppSettings } from "@/lib/mock-admin-extras";
import type { AppSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function AdminConfiguracionPage() {
  const t = useT();
  const [settings, setSettings] = useState<AppSettings>(mockAppSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => res.json())
      .then((data: Record<string, unknown>) => {
        setSettings((prev) => ({
          ...prev,
          ...(data.company ? { company: data.company as AppSettings["company"] } : {}),
          ...(data.branding ? { branding: data.branding as AppSettings["branding"] } : {}),
          ...(data.defaults ? { defaults: data.defaults as AppSettings["defaults"] } : {}),
          ...(data.notifications ? { notifications: data.notifications as AppSettings["notifications"] } : {}),
        }));
      })
      .catch(() => {
        // Si falla la carga, se mantienen los valores mock
      });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: settings.company,
          branding: settings.branding,
          defaults: settings.defaults,
          notifications: settings.notifications,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function updateCompany<K extends keyof AppSettings["company"]>(
    key: K,
    value: AppSettings["company"][K],
  ) {
    setSettings((s) => ({ ...s, company: { ...s.company, [key]: value } }));
  }
  function updateBranding<K extends keyof AppSettings["branding"]>(
    key: K,
    value: AppSettings["branding"][K],
  ) {
    setSettings((s) => ({
      ...s,
      branding: { ...s.branding, [key]: value },
    }));
  }
  function updateDefault<K extends keyof AppSettings["defaults"]>(
    key: K,
    value: AppSettings["defaults"][K],
  ) {
    setSettings((s) => ({
      ...s,
      defaults: { ...s.defaults, [key]: value },
    }));
  }
  function toggleNotification<K extends keyof AppSettings["notifications"]>(
    key: K,
  ) {
    setSettings((s) => ({
      ...s,
      notifications: {
        ...s.notifications,
        [key]: !s.notifications[key],
      },
    }));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[1100px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="config.title"
        subtitleKey="config.subtitle"
      />

      <div className="mt-7 flex flex-col gap-5">
        {/* Company */}
        <SettingsSection
          icon={<Building2 size={16} strokeWidth={1.75} />}
          titleKey="config.company.title"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              labelKey="config.company.name"
              value={settings.company.name}
              onChange={(v) => updateCompany("name", v)}
            />
            <Field
              labelKey="config.company.legalName"
              value={settings.company.legalName}
              onChange={(v) => updateCompany("legalName", v)}
            />
            <Field
              labelKey="config.company.taxId"
              value={settings.company.taxId}
              onChange={(v) => updateCompany("taxId", v)}
            />
            <Field
              labelKey="config.company.phone"
              value={settings.company.phone}
              onChange={(v) => updateCompany("phone", v)}
            />
            <Field
              labelKey="config.company.email"
              value={settings.company.email}
              onChange={(v) => updateCompany("email", v)}
              fullWidth
            />
            <Field
              labelKey="config.company.address"
              value={settings.company.address}
              onChange={(v) => updateCompany("address", v)}
              fullWidth
            />
          </div>
        </SettingsSection>

        {/* Branding */}
        <SettingsSection
          icon={<Palette size={16} strokeWidth={1.75} />}
          titleKey="config.branding.title"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ColorField
              labelKey="config.branding.primaryColor"
              value={settings.branding.primaryColor}
              onChange={(v) => updateBranding("primaryColor", v)}
            />
            <ColorField
              labelKey="config.branding.accentColor"
              value={settings.branding.accentColor}
              onChange={(v) => updateBranding("accentColor", v)}
            />
          </div>
        </SettingsSection>

        {/* Defaults */}
        <SettingsSection
          icon={<Sliders size={16} strokeWidth={1.75} />}
          titleKey="config.defaults.title"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SelectField
              labelKey="config.defaults.language"
              icon={<Globe size={14} strokeWidth={1.75} />}
              value={settings.defaults.language}
              onChange={(v) =>
                updateDefault(
                  "language",
                  v as AppSettings["defaults"]["language"],
                )
              }
              options={[
                { value: "es", label: "Español" },
                { value: "en", label: "English" },
                { value: "fr", label: "Français" },
                { value: "de", label: "Deutsch" },
              ]}
            />
            <NumberField
              labelKey="config.defaults.personalShopperMonths"
              value={settings.defaults.personalShopperMonths}
              onChange={(v) => updateDefault("personalShopperMonths", v)}
              min={0}
              max={12}
              step={1}
            />
            <NumberField
              labelKey="config.defaults.rentCommission"
              value={settings.defaults.rentCommissionPct}
              onChange={(v) => updateDefault("rentCommissionPct", v)}
              min={0}
              max={100}
              step={1}
              suffix="%"
            />
            <NumberField
              labelKey="config.defaults.saleCommission"
              value={settings.defaults.saleCommissionPct}
              onChange={(v) => updateDefault("saleCommissionPct", v)}
              min={0}
              max={100}
              step={1}
              suffix="%"
            />
          </div>
        </SettingsSection>

        {/* Notifications */}
        <SettingsSection
          icon={<Bell size={16} strokeWidth={1.75} />}
          titleKey="config.notifications.title"
        >
          <ul className="divide-y divide-gold/15">
            <ToggleRow
              labelKey="config.notifications.visitRequests"
              checked={settings.notifications.visitRequests}
              onChange={() => toggleNotification("visitRequests")}
            />
            <ToggleRow
              labelKey="config.notifications.newClients"
              checked={settings.notifications.newClients}
              onChange={() => toggleNotification("newClients")}
            />
            <ToggleRow
              labelKey="config.notifications.weeklyReport"
              checked={settings.notifications.weeklyReport}
              onChange={() => toggleNotification("weeklyReport")}
            />
            <ToggleRow
              labelKey="config.notifications.propertyUpdates"
              checked={settings.notifications.propertyUpdates}
              onChange={() => toggleNotification("propertyUpdates")}
            />
          </ul>
        </SettingsSection>

        {/* Migrations Manager */}
        <MigrationsManager />

        {/* Email Configuration */}
        <EmailConfigClient />

        {/* Save bar */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-cream-50 transition",
              saved
                ? "bg-green-700 hover:bg-green-800"
                : "bg-ink hover:bg-ink-soft",
              saving && "cursor-not-allowed opacity-60",
            )}
          >
            {saved ? (
              <>
                <Check size={14} strokeWidth={2} className="text-green-300" />
                <span>Guardado</span>
              </>
            ) : (
              <>
                <Save size={14} strokeWidth={1.75} className="text-gold" />
                <span>{saving ? "Guardando…" : t("config.save")}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Logs Viewer */}
      <div className="mt-7">
        <LogsViewer />
      </div>

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}

function SettingsSection({
  icon,
  titleKey,
  children,
}: {
  icon: React.ReactNode;
  titleKey: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-6">
      <header className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">
        <span className="text-gold">{icon}</span>
        <span>{t(titleKey)}</span>
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  labelKey,
  value,
  onChange,
  fullWidth,
}: {
  labelKey: string;
  value: string;
  onChange: (v: string) => void;
  fullWidth?: boolean;
}) {
  const t = useT();
  return (
    <label className={cn("flex flex-col gap-1.5", fullWidth && "md:col-span-2")}>
      <span className="text-[11px] font-medium text-ink/65">
        {t(labelKey)}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-ink/10 bg-white/85 px-3 py-2 text-sm text-ink focus:border-gold/55 focus:outline-none"
      />
    </label>
  );
}

function ColorField({
  labelKey,
  value,
  onChange,
}: {
  labelKey: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-ink/65">
        {t(labelKey)}
      </span>
      <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-white/85 px-3 py-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-10 cursor-pointer rounded border border-ink/10 bg-transparent"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent text-sm text-ink focus:outline-none"
        />
      </div>
    </label>
  );
}

function NumberField({
  labelKey,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  labelKey: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const t = useT();
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-ink/65">
        {t(labelKey)}
      </span>
      <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-white/85 px-3">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full bg-transparent py-2 text-sm text-ink focus:outline-none"
        />
        {suffix && (
          <span className="text-sm text-ink/55">{suffix}</span>
        )}
      </div>
    </label>
  );
}

function SelectField({
  labelKey,
  icon,
  value,
  onChange,
  options,
}: {
  labelKey: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const t = useT();
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-ink/65">
        {t(labelKey)}
      </span>
      <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-white/85 px-3">
        <span className="text-gold">{icon}</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-transparent py-2 text-sm text-ink focus:outline-none"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function ToggleRow({
  labelKey,
  checked,
  onChange,
}: {
  labelKey: string;
  checked: boolean;
  onChange: () => void;
}) {
  const t = useT();
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-ink">{t(labelKey)}</span>
      <button
        type="button"
        onClick={onChange}
        role="switch"
        aria-checked={checked}
        className={cn(
          "relative h-6 w-11 rounded-full border transition",
          checked
            ? "border-gold/50 bg-gold"
            : "border-ink/15 bg-ink/10",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </li>
  );
}
