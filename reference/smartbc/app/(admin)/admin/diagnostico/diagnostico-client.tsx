"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  KeyRound,
  Loader2,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  Users,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/* ─────────────────────────── Tipos del endpoint ─────────────────────────── */

type ClientReport = {
  ok: boolean;
  error: string | null;
  count?: number;
  byRole?: Record<string, number>;
};

type DebugData = {
  timestamp?: string;
  env?: {
    NEXT_PUBLIC_SUPABASE_URL?: boolean;
    NEXT_PUBLIC_SUPABASE_URL_value?: string | null;
    NEXT_PUBLIC_SUPABASE_ANON_KEY?: boolean;
    ANON_KEY_length?: number;
    SUPABASE_SERVICE_ROLE_KEY?: boolean;
    SERVICE_ROLE_KEY_length?: number;
  };
  currentProfile?: { id: string; role: string; email: string } | null;
  currentProfileError?: string;
  sessionClient?: ClientReport;
  adminClient?: ClientReport;
  rlsHelpers?: {
    is_staff?: boolean | null;
    is_staff_error?: string | null;
    is_admin?: boolean | null;
    is_admin_error?: string | null;
    error?: string;
  };
};

type Tone = "green" | "amber" | "red" | "neutral";

type Verdict = {
  tone: Tone;
  title: string;
  detail: string;
};

/* ─────────────────────────── Interpretación ─────────────────────────── */

function buildVerdicts(data: DebugData): Verdict[] {
  const verdicts: Verdict[] = [];
  const env = data.env ?? {};
  const session = data.sessionClient;
  const admin = data.adminClient;
  const rls = data.rlsHelpers ?? {};
  const role = data.currentProfile?.role ?? "desconocido";

  const sessionCount = session?.count ?? 0;
  const adminCount = admin?.count ?? 0;

  // 1. Service role key ausente
  if (env.SUPABASE_SERVICE_ROLE_KEY === false) {
    verdicts.push({
      tone: "red",
      title: "Falta la variable SUPABASE_SERVICE_ROLE_KEY en el VPS",
      detail:
        "El cliente admin no puede leer datos sin esta clave. Añádela a las variables de entorno del servidor y reinicia la aplicación.",
    });
  }

  // 2. is_staff false
  if (rls.is_staff === false) {
    verdicts.push({
      tone: "red",
      title: `Tu rol (${role}) no está reconocido como staff por la base de datos`,
      detail:
        "Las políticas de seguridad (RLS) no te dejan ver los perfiles. Aplica la migración 0032 para corregirlo con el botón de abajo.",
    });
  }

  // 3. Datos existen pero RLS bloquea la sesión
  if (adminCount > 0 && sessionCount === 0) {
    verdicts.push({
      tone: "red",
      title: "Los datos existen, pero RLS bloquea tu sesión",
      detail:
        "El cliente admin sí ve los usuarios, pero tu sesión no. Esto es un problema de permisos: aplica la migración 0032.",
    });
  }

  // 4. No hay perfiles en ningún cliente
  if (adminCount === 0 && sessionCount === 0) {
    verdicts.push({
      tone: "amber",
      title: "No hay perfiles en la base de datos (o la conexión falla)",
      detail:
        "Ni el cliente admin ni tu sesión devuelven perfiles. Comprueba la conexión a la base de datos y revisa los errores de cada cliente más abajo.",
    });
  }

  // 5. Todo correcto
  if (sessionCount > 0) {
    verdicts.push({
      tone: "green",
      title: "Todo correcto, los usuarios deberían aparecer",
      detail: `Tu sesión puede leer ${sessionCount} perfil${
        sessionCount === 1 ? "" : "es"
      }. Si /admin/usuarios sigue vacío, recarga la página.`,
    });
  }

  if (verdicts.length === 0) {
    verdicts.push({
      tone: "neutral",
      title: "Sin un diagnóstico claro",
      detail:
        "No se detectó un patrón conocido. Revisa el JSON crudo más abajo para más detalle.",
    });
  }

  return verdicts;
}

/* ─────────────────────────── Componente principal ─────────────────────────── */

export function DiagnosticoClient() {
  const [data, setData] = useState<DebugData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const runDiagnostic = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/admin/debug/users", {
        cache: "no-store",
      });
      const json = (await res.json()) as DebugData;
      if (!res.ok) {
        setFetchError(
          `El endpoint respondió ${res.status}. ` +
            "Puede que no tengas permiso o que la sesión haya expirado.",
        );
      }
      setData(json);
    } catch (e) {
      setFetchError(
        e instanceof Error ? e.message : "No se pudo contactar con el servidor.",
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runDiagnostic();
  }, [runDiagnostic]);

  const verdicts = data ? buildVerdicts(data) : [];
  const worstTone = verdicts.reduce<Tone>((acc, v) => {
    const rank: Record<Tone, number> = { neutral: 0, green: 1, amber: 2, red: 3 };
    return rank[v.tone] > rank[acc] ? v.tone : acc;
  }, "neutral");

  return (
    <div className="mt-7 flex flex-col gap-5">
      {/* Barra de acciones */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">
          <Stethoscope size={15} strokeWidth={1.75} className="text-gold" />
          <span>Diagnóstico del sistema de usuarios</span>
        </div>
        <button
          type="button"
          onClick={runDiagnostic}
          disabled={loading}
          className={cn(
            "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-gold/25 bg-cream-50/85 px-4 py-2 text-sm font-medium text-ink transition hover:bg-cream-50",
            loading && "cursor-not-allowed opacity-60",
          )}
        >
          <RefreshCw
            size={14}
            strokeWidth={1.75}
            className={cn("text-gold", loading && "animate-spin")}
          />
          <span>{loading ? "Ejecutando…" : "Volver a ejecutar"}</span>
        </button>
      </div>

      {/* Estado de carga */}
      {loading && !data && (
        <Card className="flex items-center gap-3 text-sm text-ink/60">
          <Loader2 size={18} strokeWidth={1.75} className="animate-spin text-gold" />
          <span>Ejecutando diagnóstico…</span>
        </Card>
      )}

      {/* Error de fetch */}
      {fetchError && (
        <div className="rounded-2xl border border-red-300/60 bg-red-50/80 p-4 text-sm text-red-800">
          <div className="flex items-start gap-2">
            <ShieldAlert size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">No se pudo ejecutar el diagnóstico</p>
              <p className="mt-1 text-red-700/90">{fetchError}</p>
            </div>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Veredicto general */}
          <SummaryBanner tone={worstTone} verdicts={verdicts} />

          {/* Veredictos detallados */}
          <div className="flex flex-col gap-3">
            {verdicts.map((v, i) => (
              <VerdictCard key={i} verdict={v} />
            ))}
          </div>

          {/* Detalle técnico en cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <EnvCard env={data.env} />
            <ProfileCard
              profile={data.currentProfile}
              error={data.currentProfileError}
              rls={data.rlsHelpers}
            />
            <ClientCard
              title="Tu sesión (con RLS)"
              subtitle="Lo que ve tu usuario al iniciar sesión. Respeta las políticas de seguridad."
              report={data.sessionClient}
            />
            <ClientCard
              title="Cliente admin (sin RLS)"
              subtitle="Lo que ve la clave de servicio. Ignora las políticas de seguridad."
              report={data.adminClient}
            />
          </div>

          {/* Aplicar migraciones */}
          <MigrationsPanel />

          {/* JSON crudo */}
          <RawJsonPanel data={data} />

          {data.timestamp && (
            <p className="text-center text-[11px] text-ink/40">
              Última ejecución:{" "}
              {new Date(data.timestamp).toLocaleString("es-ES")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── Sub-componentes ─────────────────────────── */

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </section>
  );
}

const TONE_STYLES: Record<
  Tone,
  { wrap: string; text: string; icon: React.ElementType }
> = {
  green: {
    wrap: "border-green-300/60 bg-green-50/80",
    text: "text-green-800",
    icon: CheckCircle2,
  },
  amber: {
    wrap: "border-amber-300/70 bg-amber-50/80",
    text: "text-amber-800",
    icon: AlertTriangle,
  },
  red: {
    wrap: "border-red-300/60 bg-red-50/80",
    text: "text-red-800",
    icon: XCircle,
  },
  neutral: {
    wrap: "border-ink/15 bg-cream-50/85",
    text: "text-ink/70",
    icon: Activity,
  },
};

function SummaryBanner({ tone, verdicts }: { tone: Tone; verdicts: Verdict[] }) {
  const style = TONE_STYLES[tone];
  const Icon = style.icon;
  const headline =
    tone === "green"
      ? "Todo en orden"
      : tone === "red"
        ? "Se detectó un problema que impide ver los usuarios"
        : tone === "amber"
          ? "Hay algo que revisar"
          : "Diagnóstico sin conclusión clara";

  return (
    <div
      className={cn(
        "rounded-2xl border p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)]",
        style.wrap,
      )}
    >
      <div className="flex items-start gap-3">
        <Icon size={26} strokeWidth={1.75} className={cn("shrink-0", style.text)} />
        <div className="min-w-0">
          <h2 className={cn("font-serif text-xl font-medium", style.text)}>
            {headline}
          </h2>
          <p className={cn("mt-1 text-sm", style.text, "opacity-90")}>
            {verdicts.length === 1
              ? "1 conclusión encontrada."
              : `${verdicts.length} conclusiones encontradas.`}{" "}
            Revisa el detalle a continuación.
          </p>
        </div>
      </div>
    </div>
  );
}

function VerdictCard({ verdict }: { verdict: Verdict }) {
  const style = TONE_STYLES[verdict.tone];
  const Icon = style.icon;
  return (
    <div className={cn("rounded-2xl border p-4", style.wrap)}>
      <div className="flex items-start gap-3">
        <Icon
          size={20}
          strokeWidth={1.75}
          className={cn("mt-0.5 shrink-0", style.text)}
        />
        <div className="min-w-0">
          <p className={cn("text-sm font-semibold", style.text)}>
            {verdict.title}
          </p>
          <p className={cn("mt-1 text-[13px] leading-relaxed", style.text, "opacity-90")}>
            {verdict.detail}
          </p>
        </div>
      </div>
    </div>
  );
}

function CardHeader({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <header className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">
      <span className="text-gold">{icon}</span>
      <span>{title}</span>
    </header>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        ok ? "bg-green-500" : "bg-red-500",
      )}
    />
  );
}

function EnvCard({ env }: { env?: DebugData["env"] }) {
  const rows: { label: string; ok: boolean; note?: string }[] = [
    {
      label: "URL de Supabase",
      ok: !!env?.NEXT_PUBLIC_SUPABASE_URL,
      note: env?.NEXT_PUBLIC_SUPABASE_URL_value ?? undefined,
    },
    {
      label: "Clave pública (anon)",
      ok: !!env?.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      note: env?.ANON_KEY_length
        ? `${env.ANON_KEY_length} caracteres`
        : undefined,
    },
    {
      label: "Clave de servicio (service role)",
      ok: !!env?.SUPABASE_SERVICE_ROLE_KEY,
      note: env?.SERVICE_ROLE_KEY_length
        ? `${env.SERVICE_ROLE_KEY_length} caracteres`
        : "ausente",
    },
  ];

  return (
    <Card>
      <CardHeader
        icon={<KeyRound size={16} strokeWidth={1.75} />}
        title="Variables de entorno"
      />
      <ul className="mt-4 flex flex-col divide-y divide-gold/10">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <StatusDot ok={r.ok} />
              <span className="truncate text-sm text-ink">{r.label}</span>
            </div>
            <span className="shrink-0 text-right text-[11px] text-ink/50">
              {r.ok ? r.note ?? "presente" : "falta"}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ProfileCard({
  profile,
  error,
  rls,
}: {
  profile?: DebugData["currentProfile"];
  error?: string;
  rls?: DebugData["rlsHelpers"];
}) {
  return (
    <Card>
      <CardHeader
        icon={<Users size={16} strokeWidth={1.75} />}
        title="Tu usuario y permisos"
      />
      <div className="mt-4 flex flex-col gap-2.5 text-sm">
        {error ? (
          <p className="text-red-700">No se pudo cargar tu perfil: {error}</p>
        ) : profile ? (
          <>
            <Row label="Email" value={profile.email} />
            <Row label="Rol" value={profile.role} />
            <Row label="ID" value={profile.id} mono />
          </>
        ) : (
          <p className="text-ink/55">No hay sesión activa.</p>
        )}

        <div className="mt-1 flex flex-col gap-2 border-t border-gold/10 pt-3">
          <BoolRow label="is_staff()" value={rls?.is_staff} error={rls?.is_staff_error} />
          <BoolRow label="is_admin()" value={rls?.is_admin} error={rls?.is_admin_error} />
        </div>
      </div>
    </Card>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-[12px] text-ink/55">{label}</span>
      <span
        className={cn(
          "min-w-0 break-all text-right text-[13px] text-ink",
          mono && "font-mono text-[11px]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function BoolRow({
  label,
  value,
  error,
}: {
  label: string;
  value?: boolean | null;
  error?: string | null;
}) {
  const ok = value === true;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-mono text-[12px] text-ink/65">{label}</span>
      {error ? (
        <span className="text-[11px] text-red-700">error</span>
      ) : (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
            ok
              ? "bg-green-100 text-green-800"
              : value === false
                ? "bg-red-100 text-red-800"
                : "bg-ink/5 text-ink/50",
          )}
        >
          <StatusDot ok={ok} />
          {value === null || value === undefined
            ? "—"
            : ok
              ? "true"
              : "false"}
        </span>
      )}
    </div>
  );
}

function ClientCard({
  title,
  subtitle,
  report,
}: {
  title: string;
  subtitle: string;
  report?: ClientReport;
}) {
  const ok = report?.ok ?? false;
  const count = report?.count ?? 0;
  const byRole = report?.byRole ?? {};
  const roles = Object.entries(byRole).sort((a, b) => b[1] - a[1]);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <CardHeader
          icon={<Database size={16} strokeWidth={1.75} />}
          title={title}
        />
        <StatusDot ok={ok} />
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink/55">{subtitle}</p>

      {report?.error ? (
        <p className="mt-3 break-words rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {report.error}
        </p>
      ) : (
        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-serif text-3xl font-medium text-ink">
            {count}
          </span>
          <span className="text-[12px] text-ink/55">
            perfil{count === 1 ? "" : "es"} visible{count === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {roles.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-lg border border-gold/10">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="bg-cream-100/60 text-ink/50">
                <th className="px-3 py-1.5 font-medium">Rol</th>
                <th className="px-3 py-1.5 text-right font-medium">Cantidad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/10">
              {roles.map(([role, n]) => (
                <tr key={role}>
                  <td className="px-3 py-1.5 text-ink">{role}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-ink">
                    {n}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────── Migraciones ─────────────────────────── */

type MigrationResult = {
  ok?: boolean;
  message?: string;
  output?: string;
  error?: string;
};

function MigrationsPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [showOutput, setShowOutput] = useState(false);

  async function applyMigrations() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/migrations/apply", {
        method: "POST",
      });
      const json = (await res.json()) as MigrationResult;
      setResult({ ...json, ok: json.ok ?? res.ok });
      setShowOutput(true);
    } catch (e) {
      setResult({
        ok: false,
        error: e instanceof Error ? e.message : "Error desconocido",
      });
      setShowOutput(true);
    } finally {
      setRunning(false);
    }
  }

  const success = result?.ok === true;

  return (
    <Card className="border-gold/25">
      <CardHeader
        icon={<PlayCircle size={16} strokeWidth={1.75} />}
        title="Corregir ahora"
      />
      <p className="mt-3 text-sm leading-relaxed text-ink/70">
        Aplica las migraciones pendientes (incluida la 0032) para reparar las
        políticas de seguridad. Esto suele resolver que los usuarios no
        aparezcan.
      </p>

      <button
        type="button"
        onClick={applyMigrations}
        disabled={running}
        className={cn(
          "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-cream-50 transition sm:w-auto",
          "bg-ink hover:bg-ink-soft",
          running && "cursor-not-allowed opacity-60",
        )}
      >
        {running ? (
          <Loader2 size={16} strokeWidth={1.75} className="animate-spin text-gold" />
        ) : (
          <PlayCircle size={16} strokeWidth={1.75} className="text-gold" />
        )}
        <span>{running ? "Aplicando migraciones…" : "Aplicar migraciones ahora"}</span>
      </button>

      {result && (
        <div className="mt-4">
          <div
            className={cn(
              "flex items-start gap-2 rounded-xl border p-3 text-sm",
              success
                ? "border-green-300/60 bg-green-50/80 text-green-800"
                : "border-red-300/60 bg-red-50/80 text-red-800",
            )}
          >
            {success ? (
              <CheckCircle2 size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            ) : (
              <XCircle size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-semibold">
                {success
                  ? result.message ?? "Migraciones aplicadas correctamente"
                  : "No se pudieron aplicar las migraciones"}
              </p>
              {success ? (
                <p className="mt-1 opacity-90">
                  Recarga{" "}
                  <a
                    href="/admin/usuarios"
                    className="font-medium underline underline-offset-2"
                  >
                    /admin/usuarios
                  </a>{" "}
                  para comprobar si ya aparecen los usuarios.
                </p>
              ) : (
                result.error && (
                  <p className="mt-1 break-words opacity-90">{result.error}</p>
                )
              )}
            </div>
          </div>

          {(result.output || result.error) && (
            <Collapsible
              open={showOutput}
              onToggle={() => setShowOutput((o) => !o)}
              label="Ver salida del proceso"
            >
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink p-3 text-[11px] leading-relaxed text-cream-50/90">
                {result.output ?? result.error}
              </pre>
            </Collapsible>
          )}
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────── JSON crudo ─────────────────────────── */

function RawJsonPanel({ data }: { data: DebugData }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(data, null, 2);

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard puede no estar disponible
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55"
        >
          <ChevronDown
            size={15}
            strokeWidth={2}
            className={cn(
              "text-gold transition-transform",
              open && "rotate-180",
            )}
          />
          <span>Ver JSON crudo</span>
        </button>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gold/25 px-2.5 py-1 text-[11px] font-medium text-ink transition hover:bg-cream-50"
        >
          {copied ? (
            <CheckCircle2 size={13} strokeWidth={2} className="text-green-600" />
          ) : (
            <Copy size={13} strokeWidth={1.75} className="text-gold" />
          )}
          <span>{copied ? "Copiado" : "Copiar"}</span>
        </button>
      </div>
      {open && (
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink p-3 text-[11px] leading-relaxed text-cream-50/90">
          {json}
        </pre>
      )}
    </Card>
  );
}

/* ─────────────────────────── Utilidades ─────────────────────────── */

function Collapsible({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[12px] font-medium text-ink/60 hover:text-ink"
      >
        <ChevronDown
          size={14}
          strokeWidth={2}
          className={cn("text-gold transition-transform", open && "rotate-180")}
        />
        <span>{label}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
