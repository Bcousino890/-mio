"use client";

import {
  AlertCircle,
  Check,
  Loader2,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTION_DESCRIPTIONS,
  ACTION_LABELS,
  canAccess,
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  RESOURCE_DESCRIPTIONS,
  RESOURCE_LABELS,
  type PermissionAction,
  type PermissionResource,
} from "@/lib/permissions";
import type { InternalUser, InternalUserRole } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Toggle } from "./toggle";

// Mirrors the role badge styles used in usuarios-client.tsx
const ROLE_BADGE: Record<InternalUserRole, string> = {
  owner:        "border-violet-200 bg-violet-50 text-violet-700",
  admin:        "border-emerald-200 bg-emerald-50 text-emerald-700",
  advisor:      "border-blue-200 bg-blue-50 text-blue-700",
  client:       "border-amber-200 bg-amber-50 text-amber-700",
  viewer:       "border-ink/15 bg-ink/5 text-ink/65",
  agent_junior: "border-sky-200 bg-sky-50 text-sky-700",
  agent_senior: "border-indigo-200 bg-indigo-50 text-indigo-700",
  agent_admin:  "border-purple-200 bg-purple-50 text-purple-700",
};

const ROLE_LABEL: Record<InternalUserRole, string> = {
  owner:        "Propietario",
  admin:        "Administrador",
  advisor:      "Asesor",
  client:       "Cliente",
  viewer:       "Visualizador",
  agent_junior: "Agente Junior",
  agent_senior: "Agente Senior",
  agent_admin:  "Agente Admin",
};

type PermValue = true | false | "override_true" | "override_false";
type PermMatrix = Record<string, Record<string, PermValue>>;

/** Effective on/off per cell (what the toggle shows). */
type CellState = Record<PermissionResource, Record<PermissionAction, boolean>>;
/** Role default per cell (what the toggle is compared against for "modificado"). */
type DefaultState = CellState;

interface PermissionsDrawerProps {
  user: InternalUser;
  /** Whether the current admin can persist changes (POST). */
  canEdit?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

function buildStates(
  perms: PermMatrix,
  role: string,
): { effective: CellState; defaults: DefaultState } {
  const effective = {} as CellState;
  const defaults = {} as DefaultState;
  for (const resource of PERMISSION_RESOURCES) {
    effective[resource] = {} as Record<PermissionAction, boolean>;
    defaults[resource] = {} as Record<PermissionAction, boolean>;
    for (const action of PERMISSION_ACTIONS) {
      const raw = perms[resource]?.[action];
      const effectiveOn = raw === true || raw === "override_true";
      // Role default is computed independently so the "modificado" chip is
      // accurate even if a stored override happens to match the role default.
      effective[resource][action] = effectiveOn;
      defaults[resource][action] = canAccess(role, resource, action);
    }
  }
  return { effective, defaults };
}

export function PermissionsDrawer({
  user,
  canEdit = true,
  onClose,
  onSaved,
}: PermissionsDrawerProps) {
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [saveError, setSaveError] = useState("");

  const [effective, setEffective] = useState<CellState | null>(null);
  const [defaults, setDefaults] = useState<DefaultState | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // ── Fetch on open ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    (async () => {
      try {
        const res = await fetch(`/api/admin/usuarios/${user.id}/permissions`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.error ?? "No se pudieron cargar los permisos");
          setLoadState("error");
          return;
        }
        const role: string = data.role ?? user.roleKey;
        const { effective: eff, defaults: def } = buildStates(data.permissions ?? {}, role);
        setEffective(eff);
        setDefaults(def);
        setLoadState("ready");
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Error de red");
        setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  // ── ESC to close + focus management ──────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the panel on mount
    const t = setTimeout(() => closeBtnRef.current?.focus(), 50);
    // Lock body scroll while open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // ── Derived: dirty diff vs role defaults ─────────────────────────────────────
  const overrides = useMemo(() => {
    if (!effective || !defaults) return [];
    const out: { resource: string; action: string; allowed: boolean }[] = [];
    for (const resource of PERMISSION_RESOURCES) {
      for (const action of PERMISSION_ACTIONS) {
        if (effective[resource][action] !== defaults[resource][action]) {
          out.push({ resource, action, allowed: effective[resource][action] });
        }
      }
    }
    return out;
  }, [effective, defaults]);

  const overrideCount = overrides.length;

  // ── Mutators ─────────────────────────────────────────────────────────────────
  const setCell = useCallback(
    (resource: PermissionResource, action: PermissionAction, value: boolean) => {
      setEffective((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [resource]: { ...prev[resource], [action]: value },
        };
      });
      setSaveState("idle");
    },
    [],
  );

  const setResource = useCallback(
    (resource: PermissionResource, value: boolean) => {
      setEffective((prev) => {
        if (!prev) return prev;
        const next = { ...prev[resource] };
        for (const action of PERMISSION_ACTIONS) next[action] = value;
        return { ...prev, [resource]: next };
      });
      setSaveState("idle");
    },
    [],
  );

  const setAll = useCallback((value: boolean) => {
    setEffective((prev) => {
      if (!prev) return prev;
      const next = {} as CellState;
      for (const resource of PERMISSION_RESOURCES) {
        next[resource] = {} as Record<PermissionAction, boolean>;
        for (const action of PERMISSION_ACTIONS) next[resource][action] = value;
      }
      return next;
    });
    setSaveState("idle");
  }, []);

  const resetToRole = useCallback(() => {
    if (!defaults) return;
    // Deep clone defaults into effective
    const next = {} as CellState;
    for (const resource of PERMISSION_RESOURCES) {
      next[resource] = { ...defaults[resource] };
    }
    setEffective(next);
    setSaveState("idle");
  }, [defaults]);

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!canEdit) return;
    setSaveState("saving");
    setSaveError("");
    try {
      const res = await fetch(`/api/admin/usuarios/${user.id}/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "No se pudieron guardar los permisos");
        setSaveState("error");
        return;
      }
      // Newly saved overrides become the source of truth; defaults stay the same,
      // effective stays as edited. Mark success.
      setSaveState("success");
      onSaved?.();
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Error de red");
      setSaveState("error");
    }
  }, [canEdit, overrides, user.id, onSaved]);

  // ── Global master state ──────────────────────────────────────────────────────
  const allOn = useMemo(() => {
    if (!effective) return false;
    return PERMISSION_RESOURCES.every((r) =>
      PERMISSION_ACTIONS.every((a) => effective[r][a]),
    );
  }, [effective]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Permisos de ${user.firstName} ${user.lastName}`}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-lg flex-col bg-cream-50 shadow-2xl"
        style={{ animation: "perm-drawer-in 0.28s cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-ink/10 px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50">
              <ShieldCheck size={20} strokeWidth={1.75} className="text-blue-500" />
            </span>
            <div className="min-w-0">
              <h2 className="font-serif text-lg font-semibold leading-tight text-ink">
                Permisos
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="truncate text-sm text-ink/70">
                  {user.firstName} {user.lastName}
                </span>
                <span
                  className={cn(
                    "inline-block rounded-md border px-2 py-0.5 text-[10px] font-medium",
                    ROLE_BADGE[user.roleKey],
                  )}
                >
                  {ROLE_LABEL[user.roleKey] ?? user.roleKey}
                </span>
              </div>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full p-1.5 text-ink/40 transition hover:bg-ink/5 hover:text-ink"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        {loadState === "loading" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-ink/55">
            <Loader2 size={28} className="animate-spin text-gold" />
            <p className="text-sm">Cargando permisos…</p>
          </div>
        )}

        {loadState === "error" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50">
              <AlertCircle size={24} className="text-rose-500" />
            </span>
            <p className="text-sm font-medium text-ink">No se pudieron cargar los permisos</p>
            <p className="text-sm text-ink/55">{loadError}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-xl border border-ink/10 px-5 py-2 text-sm text-ink/65 transition hover:border-ink/20 hover:text-ink"
            >
              Cerrar
            </button>
          </div>
        )}

        {loadState === "ready" && effective && defaults && (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              {/* Intro note */}
              <p className="rounded-xl border border-gold/20 bg-gold/5 px-3.5 py-3 text-[13px] leading-relaxed text-ink/70">
                El rol{" "}
                <span className="font-medium text-ink">
                  {ROLE_LABEL[user.roleKey] ?? user.roleKey}
                </span>{" "}
                concede unos permisos base. Los interruptores de abajo son{" "}
                <span className="font-medium text-ink">excepciones por usuario</span>{" "}
                que se aplican sobre ese rol. Las celdas que difieren del rol se marcan como{" "}
                <span className="rounded bg-gold/20 px-1 py-px text-[11px] font-medium text-ink">
                  modificado
                </span>
                .
              </p>

              {/* Global master toggle */}
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white/70 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    Seleccionar todos los permisos
                  </p>
                  <p className="text-[12px] text-ink/55">
                    Activa o desactiva cada permiso de cada sección.
                  </p>
                </div>
                <Toggle
                  checked={allOn}
                  onChange={setAll}
                  disabled={!canEdit}
                  aria-label="Seleccionar todos los permisos"
                />
              </div>

              {/* Resource groups */}
              <div className="mt-4 space-y-3">
                {PERMISSION_RESOURCES.map((resource) => {
                  const allInGroup = PERMISSION_ACTIONS.every(
                    (a) => effective[resource][a],
                  );
                  return (
                    <div
                      key={resource}
                      className="overflow-hidden rounded-2xl border border-ink/10 bg-white/55"
                    >
                      {/* Group header / master toggle */}
                      <div className="flex items-center justify-between gap-3 border-b border-ink/8 bg-cream-50/60 px-4 py-3">
                        <div className="min-w-0">
                          <h3 className="font-serif text-[15px] font-semibold text-ink">
                            {RESOURCE_LABELS[resource]}
                          </h3>
                          <p className="text-[12px] text-ink/55">
                            {RESOURCE_DESCRIPTIONS[resource]}
                          </p>
                        </div>
                        <label className="flex shrink-0 items-center gap-2">
                          <span className="hidden text-[11px] font-medium text-ink/55 sm:inline">
                            Seleccionar todo
                          </span>
                          <Toggle
                            checked={allInGroup}
                            onChange={(v) => setResource(resource, v)}
                            disabled={!canEdit}
                            aria-label={`Seleccionar todos los permisos de ${RESOURCE_LABELS[resource]}`}
                          />
                        </label>
                      </div>

                      {/* Action rows */}
                      <ul className="divide-y divide-ink/8">
                        {PERMISSION_ACTIONS.map((action) => {
                          const on = effective[resource][action];
                          const def = defaults[resource][action];
                          const modified = on !== def;
                          return (
                            <li
                              key={action}
                              className="flex items-center justify-between gap-3 px-4 py-2.5"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[13px] font-medium text-ink">
                                    {ACTION_LABELS[action]}
                                  </span>
                                  {modified && (
                                    <span className="rounded bg-gold/20 px-1.5 py-px text-[10px] font-medium text-ink/80">
                                      modificado
                                    </span>
                                  )}
                                  {!modified && (
                                    <span
                                      className={cn(
                                        "rounded px-1.5 py-px text-[10px] font-medium",
                                        def
                                          ? "bg-emerald-50 text-emerald-600"
                                          : "bg-ink/5 text-ink/45",
                                      )}
                                    >
                                      {def ? "rol: permitido" : "rol: denegado"}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-[12px] text-ink/55">
                                  {ACTION_DESCRIPTIONS[action]}
                                </p>
                              </div>
                              <Toggle
                                checked={on}
                                onChange={(v) => setCell(resource, action, v)}
                                disabled={!canEdit}
                                size="sm"
                                aria-label={`${ACTION_LABELS[action]} ${RESOURCE_LABELS[resource]}`}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-ink/10 bg-cream-50 px-5 py-3.5 sm:px-6">
              {saveState === "error" && (
                <p className="mb-2.5 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
                  <AlertCircle size={14} /> {saveError}
                </p>
              )}
              {saveState === "success" && (
                <p className="mb-2.5 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">
                  <Check size={14} /> Permisos guardados correctamente.
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={resetToRole}
                  disabled={!canEdit || overrideCount === 0 || saveState === "saving"}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ink/10 px-3.5 py-2.5 text-[13px] font-medium text-ink/65 transition hover:border-ink/20 hover:text-ink disabled:opacity-40"
                >
                  <RotateCcw size={14} strokeWidth={1.75} />
                  <span className="hidden sm:inline">Restablecer a valores del rol</span>
                  <span className="sm:hidden">Restablecer</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className="hidden text-[12px] text-ink/55 sm:inline">
                    {overrideCount === 0
                      ? "Sin excepciones"
                      : `${overrideCount} ${overrideCount === 1 ? "excepción" : "excepciones"}`}
                  </span>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!canEdit || saveState === "saving"}
                    className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-[13px] font-semibold text-cream-50 transition hover:bg-ink/80 disabled:opacity-40"
                  >
                    {saveState === "saving" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Check size={15} strokeWidth={2} />
                    )}
                    Guardar
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes perm-drawer-in {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
