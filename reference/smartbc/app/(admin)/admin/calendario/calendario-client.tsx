"use client";

import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  X,
  CheckCircle2,
  Clock,
  Flag,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageFooter } from "@/components/ui/page-footer";

// ---- Types ----
type VisitStatus = "pending" | "confirmed" | "completed" | "cancelled";

type PropertyOption = {
  id: string;
  title: string;
  address: string | null;
  zone: string;
  bc_reference: string | null;
};

type ProfileOption = {
  id: string;
  full_name: string | null;
  email: string;
};

type StaffOption = {
  id: string;
  full_name: string | null;
  role: string;
};

type VisitEvent = {
  id: string;
  client_id: string;
  property_id: string;
  requested_at: string;
  status: VisitStatus;
  notes: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  properties: { id: string; title: string; address: string | null; zone: string } | null;
  profiles: { id: string; full_name: string | null; email: string } | null;
};

// ---- Constants ----
const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DAY_NAMES_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const STATUS_LABELS: Record<VisitStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
};

const STATUS_COLORS: Record<VisitStatus, string> = {
  pending: "bg-amber-50 border-amber-200 text-amber-700",
  confirmed: "bg-emerald-50 border-emerald-200 text-emerald-700",
  completed: "bg-gray-100 border-gray-200 text-gray-600",
  cancelled: "bg-rose-50 border-rose-200 text-rose-600",
};

const STATUS_DOT: Record<VisitStatus, string> = {
  pending: "bg-amber-400",
  confirmed: "bg-emerald-400",
  completed: "bg-gray-400",
  cancelled: "bg-rose-400",
};

const STATUS_CARD: Record<VisitStatus, string> = {
  pending: "bg-amber-50/80 border-amber-200/60 text-amber-800",
  confirmed: "bg-emerald-50/80 border-emerald-200/60 text-emerald-800",
  completed: "bg-gray-100/80 border-gray-200/60 text-gray-600",
  cancelled: "bg-rose-50/70 border-rose-200/60 text-rose-700 line-through",
};

type FilterStatus = "all" | VisitStatus;

const FILTER_OPTIONS: { key: FilterStatus; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "pending", label: "Pendientes" },
  { key: "confirmed", label: "Confirmadas" },
  { key: "completed", label: "Completadas" },
];

// ---- Create form ----
type CreateForm = {
  property_id: string;
  client_id: string;
  assigned_to: string;
  date: string;
  time: string;
  status: VisitStatus;
  notes: string;
};

function makeDefaultCreateForm(dateStr?: string): CreateForm {
  return {
    property_id: "",
    client_id: "",
    assigned_to: "",
    date: dateStr ?? new Date().toISOString().slice(0, 10),
    time: "10:00",
    status: "pending",
    notes: "",
  };
}

// ---- Edit form ----
type EditForm = {
  status: VisitStatus;
  date: string;
  time: string;
  notes: string;
};

function makeEditForm(ev: VisitEvent): EditForm {
  const dt = new Date(ev.requested_at);
  return {
    status: ev.status,
    date: dt.toISOString().slice(0, 10),
    time: `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`,
    notes: ev.notes ?? "",
  };
}

// ---- Helpers ----
function formatTime(isoStr: string) {
  const d = new Date(isoStr);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function displayName(p: ProfileOption | null | undefined) {
  return p?.full_name?.trim() || p?.email || "—";
}

// ---- Component ----
export function CalendarioClient({
  properties,
  clients,
  staff,
}: {
  properties: PropertyOption[];
  clients: ProfileOption[];
  staff: StaffOption[];
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [events, setEvents] = useState<VisitEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>("all");

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(makeDefaultCreateForm());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Property combobox state
  const [propertySearch, setPropertySearch] = useState("");
  const [propertyDropdownOpen, setPropertyDropdownOpen] = useState(false);

  // Edit modal
  const [editEvent, setEditEvent] = useState<VisitEvent | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/calendario/events?year=${year}&month=${month}`);
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // ---- Navigation ----
  function prevMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }
  function goToday() {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth() + 1);
  }

  // ---- Create visit ----
  function openCreate(dateStr?: string) {
    setCreateForm(makeDefaultCreateForm(dateStr));
    setCreateError(null);
    setPropertySearch("");
    setPropertyDropdownOpen(false);
    setShowCreate(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const requestedAt = new Date(`${createForm.date}T${createForm.time}:00`).toISOString();
      const res = await fetch("/api/admin/calendario/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: createForm.client_id,
          property_id: createForm.property_id,
          assigned_to: createForm.assigned_to || null,
          requested_at: requestedAt,
          status: createForm.status,
          notes: createForm.notes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setCreateError(err.error ?? "Error al crear la visita");
        return;
      }
      setShowCreate(false);
      await fetchEvents();
    } catch {
      setCreateError("Error de conexión");
    } finally {
      setCreating(false);
    }
  }

  // ---- Edit visit ----
  function openEdit(ev: VisitEvent) {
    setEditEvent(ev);
    setEditForm(makeEditForm(ev));
    setEditError(null);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editEvent || !editForm) return;
    setSaving(true);
    setEditError(null);
    try {
      const requestedAt = new Date(`${editForm.date}T${editForm.time}:00`).toISOString();
      const res = await fetch(`/api/admin/calendario/events/${editEvent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editForm.status,
          requested_at: requestedAt,
          notes: editForm.notes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setEditError(err.error ?? "Error al guardar");
        return;
      }
      setEditEvent(null);
      setEditForm(null);
      await fetchEvents();
    } catch {
      setEditError("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  // ---- Calendar grid ----
  const firstDay = new Date(year, month - 1, 1);
  const startWeekDay = (firstDay.getDay() + 6) % 7; // Monday-based
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Filter events
  const filteredEvents = events.filter((ev) =>
    filter === "all" ? true : ev.status === filter,
  );

  // Map filtered events to day
  const eventsByDay: Record<number, VisitEvent[]> = {};
  for (const ev of filteredEvents) {
    const d = new Date(ev.requested_at);
    if (d.getFullYear() === year && d.getMonth() + 1 === month) {
      const day = d.getDate();
      if (!eventsByDay[day]) eventsByDay[day] = [];
      eventsByDay[day].push(ev);
    }
  }

  // Pending count from ALL events (ignoring filter)
  const pendingCount = events.filter((e) => e.status === "pending").length;

  const inputCls =
    "w-full rounded-xl border border-ink/10 bg-white/85 px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-gold/55 focus:outline-none";
  const selectCls =
    "w-full rounded-xl border border-ink/10 bg-white/85 px-3 py-2 text-sm text-ink focus:border-gold/55 focus:outline-none";

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="calendario.title"
        subtitleKey="calendario.subtitle"
        welcome={false}
      />

      {/* Main calendar section */}
      <section className="mt-7 rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm">

        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-3">

          {/* Month navigation */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={prevMonth}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 bg-white/70 text-ink/70 transition hover:bg-white"
            >
              <ChevronLeft size={15} strokeWidth={1.75} />
            </button>
            <h2 className="min-w-[190px] text-center font-serif text-xl font-medium text-ink">
              {MONTH_NAMES_ES[month - 1]} {year}
            </h2>
            <button
              type="button"
              onClick={nextMonth}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 bg-white/70 text-ink/70 transition hover:bg-white"
            >
              <ChevronRight size={15} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={goToday}
              className="ml-1 rounded-lg border border-ink/10 bg-white/70 px-3 py-1.5 text-[12px] font-medium text-ink/70 transition hover:bg-white"
            >
              Hoy
            </button>
            {loading && (
              <Loader2 size={15} strokeWidth={1.75} className="animate-spin text-gold/70" />
            )}
          </div>

          {/* Right actions */}
          <div className="flex flex-wrap items-center gap-2">
            {pendingCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                <Clock size={11} strokeWidth={2} />
                {pendingCount} pendiente{pendingCount !== 1 ? "s" : ""}
              </span>
            )}
            <button
              type="button"
              onClick={() => openCreate()}
              className="flex items-center gap-2 rounded-lg bg-gold px-3.5 py-2 text-[13px] font-medium text-ink shadow-sm transition hover:bg-gold/80"
            >
              <Plus size={14} strokeWidth={2} />
              Nueva visita
            </button>
          </div>
        </div>

        {/* Status filters */}
        <div className="mt-4 flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium transition ${
                filter === f.key
                  ? "border-gold/50 bg-gold/15 text-ink"
                  : "border-ink/10 bg-white/60 text-ink/55 hover:bg-white/90"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Day headers */}
        <div className="mt-5 grid grid-cols-7 gap-1 text-center">
          {DAY_NAMES_ES.map((d) => (
            <div key={d} className="py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink/45">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="mt-1 grid grid-cols-7 gap-1">
          {/* Empty lead cells */}
          {Array.from({ length: startWeekDay }).map((_, i) => (
            <div key={`empty-${i}`} className="h-28 rounded-lg" />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isToday = dateStr === todayStr;
            const dayEvents = eventsByDay[day] ?? [];

            return (
              <div
                key={day}
                onClick={() => openCreate(dateStr)}
                className={`h-28 cursor-pointer rounded-lg border p-1.5 transition ${
                  isToday
                    ? "border-gold/40 bg-gold/8"
                    : "border-transparent bg-white/40 hover:bg-white/70"
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-medium ${
                    isToday ? "bg-gold text-ink" : "text-ink/70"
                  }`}
                >
                  {day}
                </span>
                <div className="mt-0.5 space-y-0.5 overflow-hidden">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openEdit(ev); }}
                      title={`${ev.properties?.title ?? "Propiedad"} — ${displayName(ev.profiles)}`}
                      className={`block w-full truncate rounded border px-1 py-0.5 text-left text-[10px] font-medium transition hover:opacity-80 ${STATUS_CARD[ev.status]}`}
                    >
                      <span className="flex items-center gap-1 truncate">
                        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[ev.status]}`} />
                        {formatTime(ev.requested_at)} {ev.properties?.title ?? "—"}
                      </span>
                    </button>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="block pl-1 text-[9px] text-ink/45">
                      +{dayEvents.length - 3} más
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-ink/55">
          {(["pending", "confirmed", "completed"] as VisitStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[s]}`} />
              {STATUS_LABELS[s]}
            </span>
          ))}
        </div>
      </section>

      {/* ---- Create Visit Modal ---- */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative w-full max-w-lg overflow-y-auto max-h-[90vh] rounded-2xl border border-gold/20 bg-cream-50 p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="font-serif text-xl font-medium text-ink">Nueva visita</h3>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 bg-white/70 text-ink/70 transition hover:bg-white"
              >
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              {/* Property combobox */}
              <div className="relative">
                <label className="mb-1 block text-[12px] font-medium text-ink/70">Propiedad *</label>
                <input
                  type="text"
                  required={!createForm.property_id}
                  readOnly={!!createForm.property_id}
                  placeholder="Buscar por referencia o título..."
                  value={
                    createForm.property_id
                      ? (() => {
                          const p = properties.find((p) => p.id === createForm.property_id);
                          return p
                            ? `${p.bc_reference ? `${p.bc_reference} · ` : ""}${p.title}`
                            : "";
                        })()
                      : propertySearch
                  }
                  onClick={() => {
                    if (createForm.property_id) {
                      setCreateForm((f) => ({ ...f, property_id: "" }));
                      setPropertySearch("");
                      setPropertyDropdownOpen(true);
                    }
                  }}
                  onChange={(e) => {
                    setPropertySearch(e.target.value);
                    setPropertyDropdownOpen(true);
                    if (createForm.property_id) setCreateForm((f) => ({ ...f, property_id: "" }));
                  }}
                  onFocus={() => setPropertyDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setPropertyDropdownOpen(false), 150)}
                  className={`${inputCls} ${createForm.property_id ? "cursor-pointer bg-gold/5" : ""}`}
                />
                {/* Hidden real input for required validation */}
                <input
                  type="text"
                  required
                  value={createForm.property_id}
                  readOnly
                  className="absolute inset-0 h-0 w-0 opacity-0"
                  tabIndex={-1}
                />
                {propertyDropdownOpen && (
                  <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-ink/10 bg-white shadow-lg">
                    {properties
                      .filter((p) => {
                        if (!propertySearch) return true;
                        const q = propertySearch.toLowerCase();
                        return (
                          p.bc_reference?.toLowerCase().includes(q) ||
                          p.title.toLowerCase().includes(q)
                        );
                      })
                      .slice(0, 20)
                      .map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onMouseDown={() => {
                            setCreateForm((f) => ({ ...f, property_id: p.id }));
                            setPropertySearch("");
                            setPropertyDropdownOpen(false);
                          }}
                          className="flex w-full flex-col px-3 py-2 text-left text-[12px] hover:bg-gold/10"
                        >
                          {p.bc_reference && (
                            <span className="font-medium text-gold-800">{p.bc_reference}</span>
                          )}
                          <span className="text-ink/80">
                            {p.title}
                            {p.zone ? ` · ${p.zone}` : ""}
                          </span>
                        </button>
                      ))}
                    {properties.filter((p) => {
                      if (!propertySearch) return true;
                      const q = propertySearch.toLowerCase();
                      return (
                        p.bc_reference?.toLowerCase().includes(q) ||
                        p.title.toLowerCase().includes(q)
                      );
                    }).length === 0 && (
                      <p className="px-3 py-2 text-[12px] text-ink/45">Sin resultados</p>
                    )}
                  </div>
                )}
              </div>

              {/* Selected property address (read-only) */}
              {createForm.property_id && (() => {
                const p = properties.find((p) => p.id === createForm.property_id);
                return p?.address ? (
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-ink/70">Dirección</label>
                    <input
                      type="text"
                      readOnly
                      value={p.address}
                      className={`${inputCls} bg-ink/5 text-ink/60`}
                      tabIndex={-1}
                    />
                  </div>
                ) : null;
              })()}

              {/* Client */}
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink/70">Cliente *</label>
                <select
                  required
                  value={createForm.client_id}
                  onChange={(e) => setCreateForm((f) => ({ ...f, client_id: e.target.value }))}
                  className={selectCls}
                >
                  <option value="">Seleccionar cliente...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {displayName(c)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Assigned to */}
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink/70">Asignado a</label>
                <select
                  value={createForm.assigned_to}
                  onChange={(e) => setCreateForm((f) => ({ ...f, assigned_to: e.target.value }))}
                  className={selectCls}
                >
                  <option value="">Sin asignar</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name?.trim() || s.id}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date + Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-ink/70">Fecha *</label>
                  <input
                    type="date"
                    required
                    value={createForm.date}
                    onChange={(e) => setCreateForm((f) => ({ ...f, date: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-ink/70">Hora *</label>
                  <input
                    type="time"
                    required
                    value={createForm.time}
                    onChange={(e) => setCreateForm((f) => ({ ...f, time: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink/70">Estado</label>
                <select
                  value={createForm.status}
                  onChange={(e) => setCreateForm((f) => ({ ...f, status: e.target.value as VisitStatus }))}
                  className={selectCls}
                >
                  <option value="pending">Pendiente</option>
                  <option value="confirmed">Confirmada</option>
                  <option value="completed">Completada</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink/70">Notas</label>
                <textarea
                  rows={2}
                  value={createForm.notes}
                  onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Observaciones, instrucciones de acceso..."
                  className={`${inputCls} resize-none`}
                />
              </div>

              {createError && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                  {createError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-ink/10 bg-white/70 px-4 py-2 text-[13px] font-medium text-ink/70 transition hover:bg-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-[13px] font-medium text-ink transition hover:bg-gold/80 disabled:opacity-60"
                >
                  {creating ? (
                    <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
                  ) : (
                    <Plus size={13} strokeWidth={2} />
                  )}
                  Crear visita
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---- Edit Visit Modal ---- */}
      {editEvent && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={() => { setEditEvent(null); setEditForm(null); }}
          />
          <div className="relative w-full max-w-lg overflow-y-auto max-h-[90vh] rounded-2xl border border-gold/20 bg-cream-50 p-6 shadow-2xl">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-serif text-xl font-medium text-ink">Editar visita</h3>
              <button
                type="button"
                onClick={() => { setEditEvent(null); setEditForm(null); }}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 bg-white/70 text-ink/70 transition hover:bg-white"
              >
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>

            {/* Visit summary */}
            <div className="mb-4 mt-2 rounded-xl border border-gold/10 bg-cream-100/60 px-4 py-3">
              <p className="text-[13px] font-medium text-ink">
                {editEvent.properties?.title ?? "Propiedad no disponible"}
              </p>
              <p className="mt-0.5 text-[12px] text-ink/60">
                Cliente: {displayName(editEvent.profiles)}
              </p>
              <span className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[editEvent.status]}`}>
                {editEvent.status === "confirmed" && <CheckCircle2 size={10} strokeWidth={2} />}
                {editEvent.status === "pending" && <Clock size={10} strokeWidth={2} />}
                {editEvent.status === "completed" && <Flag size={10} strokeWidth={2} />}
                {STATUS_LABELS[editEvent.status]}
              </span>
            </div>

            <form onSubmit={handleEdit} className="space-y-4">
              {/* Status */}
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink/70">Estado</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm((f) => f ? { ...f, status: e.target.value as VisitStatus } : f)}
                  className={selectCls}
                >
                  <option value="pending">Pendiente</option>
                  <option value="confirmed">Confirmada</option>
                  <option value="completed">Completada</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </div>

              {/* Reschedule */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-ink/70">Fecha</label>
                  <input
                    type="date"
                    value={editForm.date}
                    onChange={(e) => setEditForm((f) => f ? { ...f, date: e.target.value } : f)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-ink/70">Hora</label>
                  <input
                    type="time"
                    value={editForm.time}
                    onChange={(e) => setEditForm((f) => f ? { ...f, time: e.target.value } : f)}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink/70">Notas</label>
                <textarea
                  rows={3}
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => f ? { ...f, notes: e.target.value } : f)}
                  placeholder="Añade notas o instrucciones..."
                  className={`${inputCls} resize-none`}
                />
              </div>

              {editError && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                  {editError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setEditEvent(null); setEditForm(null); }}
                  className="rounded-lg border border-ink/10 bg-white/70 px-4 py-2 text-[13px] font-medium text-ink/70 transition hover:bg-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-[13px] font-medium text-ink transition hover:bg-gold/80 disabled:opacity-60"
                >
                  {saving ? (
                    <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={13} strokeWidth={2} />
                  )}
                  Guardar cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}
