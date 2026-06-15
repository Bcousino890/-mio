"use client";

import {
  Check,
  Clock,
  Eye,
  Heart,
  Info,
  Mail,
  MapPin,
  MessageSquare,
  MoreVertical,
  PawPrint,
  Pencil,
  Phone,
  RotateCcw,
  Save,
  Star,
  Users,
} from "lucide-react";
import { useState, useTransition } from "react";
import { saveClientPreferences } from "@/app/(admin)/admin/clientes/actions";
import { useT } from "@/lib/i18n/provider";
import { MADRID_ZONES } from "@/lib/mock-properties";
import type {
  AdminClient,
  ClientProfileType,
  Operation,
  StayType,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type FeedbackKind = "idle" | "saved" | "error";

type FiltersState = {
  profileType: ClientProfileType;
  operation: Operation;
  stayType: StayType;
  preferredZone: string;
  sector: string;
  budgetMin: number;
  budgetMax: number;
  occupants: number;
  students: number;
  workers: number;
  pets: boolean;
};

function snapshotFromClient(client: AdminClient): FiltersState {
  return {
    profileType: client.profileType,
    operation: client.operation,
    stayType: client.stayType,
    preferredZone: client.preferredZone,
    sector: client.sector,
    budgetMin: client.budgetMin,
    budgetMax: client.budgetMax,
    occupants: client.occupants,
    students: client.students,
    workers: client.workers,
    pets: client.pets,
  };
}

function statesEqual(a: FiltersState, b: FiltersState): boolean {
  return (
    a.profileType === b.profileType &&
    a.operation === b.operation &&
    a.stayType === b.stayType &&
    a.preferredZone === b.preferredZone &&
    a.sector === b.sector &&
    a.budgetMin === b.budgetMin &&
    a.budgetMax === b.budgetMax &&
    a.occupants === b.occupants &&
    a.students === b.students &&
    a.workers === b.workers &&
    a.pets === b.pets
  );
}

const PROFILE_OPTIONS: { value: ClientProfileType; labelKey: string }[] = [
  { value: "student", labelKey: "clientes.profile.student" },
  { value: "worker", labelKey: "clientes.profile.worker" },
];

const OPERATION_OPTIONS: { value: Operation; labelKey: string }[] = [
  { value: "alquiler", labelKey: "filters.operation.rent" },
  { value: "venta", labelKey: "filters.operation.sale" },
];

const STAY_OPTIONS: { value: StayType; labelKey: string }[] = [
  { value: "corta", labelKey: "filters.stay.short" },
  { value: "larga", labelKey: "filters.stay.long" },
];

export function ClientDetailPanel({
  client,
}: {
  client: AdminClient | undefined;
}) {
  const t = useT();

  if (!client) {
    return (
      <aside className="flex flex-col items-center justify-center rounded-2xl border border-gold/15 bg-cream-50/85 p-8 text-center shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm">
        <p className="font-serif text-lg text-ink">
          {t("clientes.detail.empty.title")}
        </p>
        <p className="mt-2 max-w-xs text-sm text-ink/60">
          {t("clientes.detail.empty.text")}
        </p>
      </aside>
    );
  }

  return <ClientDetailPanelInner client={client} />;
}

function ClientDetailPanelInner({ client }: { client: AdminClient }) {
  // El snapshot inicial es lo que viene de BD (vía adapter). Editamos sobre él
  // y comparamos para saber si hay cambios pendientes.
  const initial = snapshotFromClient(client);
  const [state, setState] = useState<FiltersState>(initial);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<FeedbackKind>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isDirty = !statesEqual(state, initial);

  const handleSave = () => {
    setFeedback("idle");
    setErrorMsg(null);
    startTransition(async () => {
      const result = await saveClientPreferences({
        clientId: client.id,
        operation: state.operation,
        stayType: state.stayType,
        preferredZone: state.preferredZone,
        budgetMin: state.budgetMin,
        budgetMax: state.budgetMax,
        occupants: state.occupants,
        students: state.students,
        workers: state.workers,
        pets: state.pets,
      });
      if (result.ok) {
        setFeedback("saved");
        setTimeout(() => setFeedback("idle"), 2500);
      } else {
        setFeedback("error");
        setErrorMsg(result.error);
      }
    });
  };

  const handleReset = () => {
    setState(initial);
    setFeedback("idle");
    setErrorMsg(null);
  };

  return (
    <aside className="flex flex-col rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-6">
      <ClientHeader client={client} />
      <ContactInfo client={client} />
      <ActivityBlock client={client} />
      <CustomFiltersBlock state={state} setState={setState} />
      <InternalNotesBlock client={client} />
      <ActionsRow
        isDirty={isDirty}
        isPending={isPending}
        feedback={feedback}
        errorMsg={errorMsg}
        onSave={handleSave}
        onReset={handleReset}
      />
    </aside>
  );
}

// ─── Avatar helpers ───────────────────────────────────────────────────────────

const AVATAR_COLORS_PANEL = [
  "bg-gold/20 text-amber-800",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-orange-100 text-orange-700",
];

function getPanelAvatarColor(name: string): string {
  const code = name.charCodeAt(0) + (name.charCodeAt(1) || 0);
  return AVATAR_COLORS_PANEL[code % AVATAR_COLORS_PANEL.length];
}

// ─────────────────────────────────────────────────────────────────────────────

function ClientHeader({ client }: { client: AdminClient }) {
  const t = useT();
  const isActive = client.status === "active";
  const fullName = `${client.firstName} ${client.lastName}`.trim();
  const avatarColor = getPanelAvatarColor(fullName || client.email);
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            avatarColor,
          )}
        >
          {client.avatarInitials}
        </span>
        <div className="min-w-0">
          <h2 className="truncate font-serif text-xl font-semibold text-ink">
            {client.firstName} {client.lastName}
          </h2>
          <span
            className={cn(
              "mt-1 inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
              isActive
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-ink/15 bg-ink/5 text-ink/55",
            )}
          >
            {t(`clientes.status.${client.status}`)}
          </span>
        </div>
      </div>
      <button
        type="button"
        aria-label="Más opciones"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/45 transition hover:bg-white/60 hover:text-ink"
      >
        <MoreVertical size={16} strokeWidth={1.75} />
      </button>
    </header>
  );
}

function ContactInfo({ client }: { client: AdminClient }) {
  return (
    <ul className="mt-4 grid grid-cols-1 gap-2 text-[12px] text-ink/70 sm:grid-cols-3">
      <li className="flex items-center gap-1.5 truncate">
        <Mail size={13} strokeWidth={1.75} className="text-gold" />
        <span className="truncate">{client.email}</span>
      </li>
      {client.phone && (
        <li className="flex items-center gap-1.5">
          <Phone size={13} strokeWidth={1.75} className="text-gold" />
          <span>{client.phone}</span>
        </li>
      )}
      {client.location && (
        <li className="flex items-center gap-1.5">
          <MapPin size={13} strokeWidth={1.75} className="text-gold" />
          <span>{client.location}</span>
        </li>
      )}
    </ul>
  );
}

function ActivityBlock({ client }: { client: AdminClient }) {
  const t = useT();
  const a = client.activity;
  const lastConn = a.lastConnectionLabelKey
    ? t(a.lastConnectionLabelKey, { time: a.lastConnectionValue ?? "" })
    : (a.lastConnectionText ?? "—");
  return (
    <section className="mt-5 border-t border-gold/15 pt-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/55">
        {t("clientes.detail.activity.title")}
      </p>
      <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
        <ActivityItem
          icon={<Eye size={15} strokeWidth={1.75} />}
          value={a.propertiesViewed}
          labelKey="clientes.detail.activity.viewed"
        />
        <ActivityItem
          icon={<Heart size={15} strokeWidth={1.75} />}
          value={a.favorites}
          labelKey="clientes.detail.activity.favorites"
        />
        <ActivityItem
          icon={<Calendar15 />}
          value={a.visitsRequested}
          labelKey="clientes.detail.activity.visits"
        />
        <ActivityItem
          icon={<MessageSquare size={15} strokeWidth={1.75} />}
          value={a.messages}
          labelKey="clientes.detail.activity.messages"
        />
        <ActivityItem
          icon={<Clock size={15} strokeWidth={1.75} />}
          value={lastConn}
          labelKey="clientes.detail.activity.lastConnection"
        />
      </ul>
    </section>
  );
}

function Calendar15() {
  // Using lucide Calendar at 15 to match the others
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function ActivityItem({
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
    <li className="flex flex-col items-center gap-1 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/15 text-gold">
        {icon}
      </span>
      <span className="font-serif text-base font-semibold text-ink">
        {value}
      </span>
      <span className="text-[10px] leading-tight text-ink/55">{t(labelKey)}</span>
    </li>
  );
}

function CustomFiltersBlock({
  state,
  setState,
}: {
  state: FiltersState;
  setState: React.Dispatch<React.SetStateAction<FiltersState>>;
}) {
  const t = useT();

  // Helper para update parcial sin escribir el spread en cada handler.
  const patch = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  return (
    <section className="mt-5 border-t border-gold/15 pt-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/55">
        {t("clientes.detail.filters.title")}
      </p>

      <div className="mt-3 space-y-3">
        <FilterRow label={t("clientes.detail.filters.profile")}>
          <Toggle
            value={state.profileType}
            onChange={(v) => patch("profileType", v as ClientProfileType)}
            options={PROFILE_OPTIONS.map((o) => ({
              value: o.value,
              label: t(o.labelKey),
            }))}
          />
        </FilterRow>
        <FilterRow label={t("clientes.detail.filters.operation")}>
          <Toggle
            value={state.operation}
            onChange={(v) => patch("operation", v as Operation)}
            options={OPERATION_OPTIONS.map((o) => ({
              value: o.value,
              label: t(o.labelKey),
            }))}
          />
        </FilterRow>
        <FilterRow label={t("clientes.detail.filters.stay")}>
          <Toggle
            value={state.stayType}
            onChange={(v) => patch("stayType", v as StayType)}
            options={STAY_OPTIONS.map((o) => ({
              value: o.value,
              label: t(o.labelKey),
            }))}
          />
        </FilterRow>
        <FilterRow label={t("clientes.detail.filters.sector")}>
          <Select
            value={state.sector}
            onChange={(v) => patch("sector", v)}
            options={["Madrid"].map((v) => ({ value: v, label: v }))}
          />
        </FilterRow>
        <FilterRow label={t("clientes.detail.filters.zone")}>
          <Select
            value={state.preferredZone}
            onChange={(v) => patch("preferredZone", v)}
            options={MADRID_ZONES.map((z) => ({ value: z, label: z }))}
          />
        </FilterRow>
        <FilterRow label={t("clientes.detail.filters.budget")}>
          <BudgetRange
            min={state.budgetMin}
            max={state.budgetMax}
            onChange={(min, max) =>
              setState((s) => ({ ...s, budgetMin: min, budgetMax: max }))
            }
          />
        </FilterRow>
        <FilterRow label={t("clientes.detail.filters.occupants")}>
          <NumberInput
            value={state.occupants}
            onChange={(v) => patch("occupants", v)}
            min={0}
            icon={<Users size={13} strokeWidth={1.75} />}
            suffix={t("clientes.detail.filters.occupants.unit")}
          />
        </FilterRow>
        <FilterRow label={t("clientes.detail.filters.students")}>
          <NumberInput
            value={state.students}
            onChange={(v) => patch("students", v)}
            min={0}
          />
        </FilterRow>
        <FilterRow label={t("clientes.detail.filters.workers")}>
          <NumberInput
            value={state.workers}
            onChange={(v) => patch("workers", v)}
            min={0}
          />
        </FilterRow>
        <FilterRow label={t("clientes.detail.filters.pets")}>
          <Toggle
            value={state.pets ? "yes" : "no"}
            onChange={(v) => patch("pets", v === "yes")}
            options={[
              {
                value: "yes",
                label: t("clientes.detail.filters.pets.yes"),
                icon: <PawPrint size={13} strokeWidth={1.75} />,
              },
              {
                value: "no",
                label: t("clientes.detail.filters.pets.no"),
              },
            ]}
          />
        </FilterRow>
      </div>

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-gold/30 bg-cream-100/60 p-2.5 text-[11px] leading-snug text-ink/70">
        <Info size={13} strokeWidth={1.75} className="mt-0.5 shrink-0 text-gold" />
        <span>{t("clientes.detail.filters.notice")}</span>
      </p>
    </section>
  );
}

function BudgetRange({
  min,
  max,
  onChange,
}: {
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-2">
      <NumberInput
        value={min}
        onChange={(v) => onChange(v, max)}
        min={0}
        suffix={t("clientes.detail.filters.budget.unit.from")}
      />
      <NumberInput
        value={max}
        onChange={(v) => onChange(min, v)}
        min={0}
        suffix={t("clientes.detail.filters.budget.unit.to")}
      />
    </div>
  );
}

function InternalNotesBlock({ client }: { client: AdminClient }) {
  const t = useT();
  return (
    <section className="mt-5 border-t border-gold/15 pt-4">
      <header className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/55">
          {t("clientes.detail.notes.title")}
        </p>
        <button
          type="button"
          aria-label={t("clientes.detail.actions.editNotes")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink/45 transition hover:bg-white/60 hover:text-ink"
        >
          <Pencil size={13} strokeWidth={1.75} />
        </button>
      </header>

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

        <p
          className={cn(
            "mt-3 flex items-center gap-1.5 text-[12px] font-semibold",
            client.priority === "high" ? "text-amber-700" : "text-ink/55",
          )}
        >
          <Star
            size={13}
            strokeWidth={1.75}
            className={cn(
              client.priority === "high"
                ? "fill-amber-500 text-amber-500"
                : "text-ink/40",
            )}
          />
          <span>
            {t(`clientes.detail.notes.priority.${client.priority}`)}
          </span>
        </p>
      </div>
    </section>
  );
}

function ActionsRow({
  isDirty,
  isPending,
  feedback,
  errorMsg,
  onSave,
  onReset,
}: {
  isDirty: boolean;
  isPending: boolean;
  feedback: FeedbackKind;
  errorMsg: string | null;
  onSave: () => void;
  onReset: () => void;
}) {
  const t = useT();

  return (
    <div className="mt-5 border-t border-gold/15 pt-4">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onReset}
          disabled={!isDirty || isPending}
          className={cn(
            "flex items-center justify-center gap-2 rounded-xl border border-gold/30 bg-white/80 px-4 py-2.5 text-[13px] font-medium text-ink transition",
            "hover:border-gold/55 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <RotateCcw size={14} strokeWidth={1.75} className="text-gold" />
          <span>{t("clientes.detail.actions.reset")}</span>
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || isPending}
          className={cn(
            "flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[13px] font-medium text-cream-50 transition",
            "hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <Save size={14} strokeWidth={1.75} className="text-gold" />
          <span>
            {isPending
              ? t("clientes.detail.actions.saving")
              : t("clientes.detail.actions.saveFilters")}
          </span>
        </button>
      </div>

      {feedback === "saved" && (
        <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[12px] font-medium text-emerald-700">
          <Check size={13} strokeWidth={2} />
          <span>{t("clientes.detail.actions.saved")}</span>
        </p>
      )}
      {feedback === "error" && (
        <p className="mt-2.5 text-center text-[12px] font-medium text-red-600">
          {t("clientes.detail.actions.error")}
          {errorMsg ? ` · ${errorMsg}` : ""}
        </p>
      )}
      {feedback === "idle" && isDirty && (
        <p className="mt-2.5 text-center text-[11px] text-ink/55">
          {t("clientes.detail.actions.unsaved")}
        </p>
      )}
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-center gap-3">
      <span className="text-[11px] font-medium text-ink/60">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-ink/10 bg-white/70 p-1">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition",
              active
                ? "bg-ink text-cream-50 shadow-sm"
                : "text-ink/65 hover:text-ink",
            )}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}


function NumberInput({
  value,
  onChange,
  min,
  icon,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  icon?: React.ReactNode;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-white/70 px-3 py-1.5 text-[12px] text-ink focus-within:border-gold/55">
      {icon && <span className="text-gold">{icon}</span>}
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="w-full bg-transparent py-0.5 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix && <span className="shrink-0 text-ink/50">{suffix}</span>}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full appearance-none rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-[12px] text-ink focus:border-gold/55 focus:outline-none"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
