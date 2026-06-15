"use client";

import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  ShoppingBag,
  User,
} from "lucide-react";
import { useActionState, useState } from "react";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { signInAction, type SignInState } from "@/app/(auth)/actions";

type Role = "client" | "admin";

const initialState: SignInState = {};

export function LoginForm() {
  const t = useT();
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const [role, setRole] = useState<Role>("client");
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit =
    !pending &&
    email.length > 0 &&
    password.length > 0 &&
    (role === "admin" || accepted);

  return (
    <form
      action={formAction}
      className="w-full max-w-md rounded-[20px] border border-white/60 bg-cream-50/85 px-6 pb-5 pt-3.5 shadow-[0_30px_80px_-20px_rgba(40,28,10,0.45),0_0_0_1px_rgba(201,169,110,0.18)] backdrop-blur-md md:px-8 md:pb-6 md:pt-4"
    >
      <div className="flex flex-col items-center text-center">
        <KeyRound
          className="text-gold"
          size={22}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="mt-1.5 h-px w-8 bg-gold/60" />
        <h2 className="mt-2 font-serif text-2xl font-medium leading-tight tracking-tight text-ink md:text-[1.75rem]">
          {t("login.title")}
        </h2>
        <p className="mt-1 text-[13px] text-ink/60">{t("login.subtitle")}</p>
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-2 rounded-xl border border-gold/20 bg-white/40 p-1.5">
        <RoleTab
          active={role === "client"}
          onClick={() => setRole("client")}
          icon={<User size={16} strokeWidth={1.75} />}
          label={t("login.role.client")}
        />
        <RoleTab
          active={role === "admin"}
          onClick={() => setRole("admin")}
          icon={<ShieldCheck size={16} strokeWidth={1.75} />}
          label={t("login.role.admin")}
        />
      </div>

      <input type="hidden" name="role" value={role} />

      <div className="mt-3.5 space-y-2.5">
        <Field icon={<Mail size={18} strokeWidth={1.5} />}>
          <input
            name="email"
            type="email"
            autoComplete="username"
            placeholder={t("login.email.placeholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-transparent py-2.5 pr-3 text-sm text-ink placeholder:text-ink/40 focus:outline-none"
          />
        </Field>

        <Field icon={<Lock size={18} strokeWidth={1.5} />}>
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder={t("login.password.placeholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-transparent py-2.5 pr-2 text-sm text-ink placeholder:text-ink/40 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={
              showPassword ? t("login.password.hide") : t("login.password.show")
            }
            className="pr-3 text-ink/40 transition hover:text-ink/70"
          >
            {showPassword ? (
              <EyeOff size={18} strokeWidth={1.5} />
            ) : (
              <Eye size={18} strokeWidth={1.5} />
            )}
          </button>
        </Field>
      </div>

      {role === "client" && (
        <div className="mt-3.5 rounded-xl border border-gold/30 bg-cream-100/70 p-3">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold/50 text-gold">
              <ShoppingBag size={14} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="font-serif text-sm font-semibold text-ink">
                {t("login.shopper.title")}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-ink/70">
                {t("login.shopper.text")}
              </p>
            </div>
          </div>

          <div className="mt-2.5 border-t border-gold/20 pt-2.5">
            <label className="flex cursor-pointer items-start gap-2 text-[11px] text-ink/80">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-ink"
              />
              <span>{t("login.shopper.accept")}</span>
            </label>
          </div>
        </div>
      )}

      {state.error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-300/60 bg-red-50/80 px-3 py-2 text-[12px] text-red-700"
        >
          {t(state.error)}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className={cn(
          "mt-4 flex w-full items-center justify-center gap-3 rounded-xl bg-ink px-5 py-3 text-sm font-medium tracking-wide text-cream-50 transition",
          "hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span>{pending ? t("login.submitting") : t("login.submit")}</span>
        <ArrowRight size={18} strokeWidth={1.75} className="text-gold" />
      </button>

      <div className="mt-2.5 text-center">
        <a
          href="/auth/forgot-password"
          className="text-[13px] text-gold-dark underline-offset-4 transition hover:underline"
        >
          {t("login.forgot")}
        </a>
      </div>

      <div className="mt-3 flex flex-col items-center border-t border-gold/20 pt-3">
        <ShieldCheck
          size={14}
          strokeWidth={1.5}
          className="text-gold"
          aria-hidden="true"
        />
        <p className="mt-1 text-center text-[11px] text-ink/55">
          {t("login.footer")}
        </p>
      </div>
    </form>
  );
}

function RoleTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
        active
          ? "bg-ink text-gold shadow-sm"
          : "text-ink/60 hover:bg-white/60 hover:text-ink",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Field({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center rounded-xl border border-gold/25 bg-white/60 transition focus-within:border-gold/60 focus-within:bg-white/80">
      <span className="pl-3 pr-2.5 text-ink/40">{icon}</span>
      {children}
    </div>
  );
}
