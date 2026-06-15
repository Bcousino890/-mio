"use client";

import {
  AlertTriangle,
  Building2,
  Check,
  ExternalLink,
  ImagePlus,
  Key,
  Loader2,
  Search,
  Send,
  User,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MediaManager } from "./media-manager";
import { IdealistaForm, type IdealistaListing } from "./idealista-form";

export type PublicacionProperty = {
  id: string;
  slug: string;
  title: string;
  zone: string | null;
  price: number | string | null;
  operation: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_meters: number | null;
  status: string | null;
  cover_photo_url: string | null;
  external_id: string | null;
  bc_reference: string | null;
  created_at: string;
};

type SourceFilter = "" | "own" | "agency" | "particular" | "unknown";

// Determina la fuente de una propiedad basándose en sus referencias
function getSource(p: PublicacionProperty): "own" | "agency" | "particular" | "unknown" {
  if (p.bc_reference) return "own";
  if (p.external_id?.startsWith("idealista-")) return "particular";
  if (p.external_id) return "agency";
  return "unknown";
}

const SOURCE_LABEL: Record<ReturnType<typeof getSource>, string> = {
  own: "Propia BC",
  agency: "Agencia",
  particular: "Particular",
  unknown: "Sin fuente",
};

const SOURCE_STYLE: Record<ReturnType<typeof getSource>, string> = {
  own: "border-emerald-200 bg-emerald-50 text-emerald-700",
  agency: "border-blue-200 bg-blue-50 text-blue-700",
  particular: "border-violet-200 bg-violet-50 text-violet-700",
  unknown: "border-amber-200 bg-amber-50 text-amber-700",
};

type PublishStatus = "idle" | "loading" | "success" | "error";

type PropertyPublishState = {
  status: PublishStatus;
  message?: string;
};

const DATE_FMT = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

// ─── Modal de clave API ───────────────────────────────────────────────────────

function ApiKeyModal({
  onSave,
  onClose,
  currentKey,
}: {
  onSave: (key: string) => void;
  onClose: () => void;
  currentKey: string;
}) {
  const [key, setKey] = useState(currentKey);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-cream-50 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="font-serif text-xl font-semibold text-ink">
              Clave API Idealista
            </h2>
            <p className="mt-0.5 text-sm text-ink/55">
              Clave para volcados — importación masiva
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-ink/40 hover:bg-ink/5 hover:text-ink"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4">
          <p className="font-semibold mb-1">¿Dónde obtengo la clave?</p>
          <p className="text-amber-700">
            Solicítala a Idealista como cliente profesional. Te la envían por email junto con la documentación del API de volcado (importación masiva de propiedades).
          </p>
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wider text-ink/50 mb-1.5">
          API Key
        </label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Pega aquí tu clave de Idealista…"
          className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-gold/55 focus:outline-none"
          autoFocus
        />

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-ink/10 py-2.5 text-sm text-ink/65 transition hover:border-ink/20 hover:text-ink"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => { onSave(key.trim()); onClose(); }}
            disabled={!key.trim()}
            className="flex-1 rounded-xl bg-ink py-2.5 text-sm font-semibold text-cream-50 transition hover:bg-ink/80 disabled:opacity-40"
          >
            Guardar clave
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function PublicacionClient({
  properties,
}: {
  properties: PublicacionProperty[];
}) {
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState<"" | "rent" | "sale">("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("own");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingIdealistaProperty, setEditingIdealistaProperty] = useState<PublicacionProperty | null>(null);
  const [publishStates, setPublishStates] = useState<
    Record<string, PropertyPublishState>
  >({});
  const [apiKey, setApiKey] = useState("");
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [isBulkPublishing, setIsBulkPublishing] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  const sourceCounts = useMemo(() => {
    const counts = { own: 0, agency: 0, particular: 0, unknown: 0 };
    for (const p of properties) counts[getSource(p)]++;
    return counts;
  }, [properties]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return properties.filter((p) => {
      if (operation && p.operation !== operation) return false;
      if (sourceFilter && getSource(p) !== sourceFilter) return false;
      if (q) {
        const hay =
          p.title.toLowerCase().includes(q) ||
          (p.zone?.toLowerCase().includes(q) ?? false) ||
          (p.bc_reference?.toLowerCase().includes(q) ?? false) ||
          (p.external_id?.toLowerCase().includes(q) ?? false);
        if (!hay) return false;
      }
      return true;
    });
  }, [properties, query, operation, sourceFilter]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => p.id)));
    }
  };

  const publishProperty = async (property: PublicacionProperty) => {
    if (!apiKey) {
      setShowApiKeyModal(true);
      return;
    }

    setPublishStates((prev) => ({
      ...prev,
      [property.id]: { status: "loading" },
    }));

    try {
      const res = await fetch("/api/admin/publicacion/idealista", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property, apiKey }),
      });

      const data = await res.json();

      setPublishStates((prev) => ({
        ...prev,
        [property.id]: {
          status: res.ok ? "success" : "error",
          message: res.ok
            ? `Publicado en Idealista (ref: ${data.idealistaId ?? "—"})`
            : data.error ?? "Error desconocido",
        },
      }));
    } catch (err) {
      setPublishStates((prev) => ({
        ...prev,
        [property.id]: {
          status: "error",
          message: err instanceof Error ? err.message : "Error de red",
        },
      }));
    }
  };

  const publishSelected = async () => {
    if (!apiKey) { setShowApiKeyModal(true); return; }
    if (selected.size === 0) return;

    setIsBulkPublishing(true);
    setBulkMessage(null);
    let ok = 0;
    let fail = 0;

    for (const id of selected) {
      const prop = properties.find((p) => p.id === id);
      if (!prop) continue;
      await publishProperty(prop);
      const state = publishStates[id];
      if (state?.status === "success") ok++;
      else fail++;
    }

    setBulkMessage({
      text: `Volcado completado: ${ok} publicadas, ${fail} errores`,
      type: fail === 0 ? "success" : "error",
    });
    setIsBulkPublishing(false);
    setTimeout(() => setBulkMessage(null), 6000);
  };

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  const handleSaveIdealistaListing = async (data: IdealistaListing) => {
    try {
      const res = await fetch("/api/admin/publicacion/save-idealista-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Error al guardar");
      }

      setEditingIdealistaProperty(null);
    } catch (err) {
      throw err instanceof Error ? err : new Error("Error desconocido");
    }
  };

  return (
    <>
      {showApiKeyModal && (
        <ApiKeyModal
          currentKey={apiKey}
          onSave={setApiKey}
          onClose={() => setShowApiKeyModal(false)}
        />
      )}

      {editingIdealistaProperty && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/50 p-4 backdrop-blur-sm">
          <div className="mx-auto max-w-3xl py-6">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setEditingIdealistaProperty(null)}
                className="text-ink/40 hover:text-ink"
              >
                <X size={24} strokeWidth={2} />
              </button>
            </div>
            <IdealistaForm
              propertyId={editingIdealistaProperty.id}
              propertyTitle={editingIdealistaProperty.title}
              onSave={handleSaveIdealistaListing}
            />
          </div>
        </div>
      )}

      <section className="mt-5 rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-6">
        {/* Filtros de fuente */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(
            [
              { value: "" as SourceFilter, label: "Todas", count: properties.length },
              { value: "own" as SourceFilter, label: "Propias BC", count: sourceCounts.own },
              { value: "agency" as SourceFilter, label: "Agencias", count: sourceCounts.agency },
              { value: "particular" as SourceFilter, label: "Particulares", count: sourceCounts.particular },
              { value: "unknown" as SourceFilter, label: "Sin fuente", count: sourceCounts.unknown },
            ] as const
          ).map(({ value, label, count }) => (
            <button
              key={value}
              type="button"
              onClick={() => setSourceFilter(value)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition",
                sourceFilter === value
                  ? "border-ink bg-ink text-cream-50"
                  : "border-ink/10 bg-white/85 text-ink/65 hover:border-ink/25 hover:text-ink",
              )}
            >
              {value === "own" && <Check size={11} strokeWidth={2.5} />}
              {value === "agency" && <Building2 size={11} strokeWidth={1.75} />}
              {value === "particular" && <User size={11} strokeWidth={1.75} />}
              {value === "unknown" && <AlertTriangle size={11} strokeWidth={1.75} />}
              {label}
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px]",
                sourceFilter === value ? "bg-white/20 text-white" : "bg-ink/8 text-ink/55"
              )}>
                {count}
              </span>
            </button>
          ))}
          {sourceFilter !== "own" && (
            <span className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
              <AlertTriangle size={11} strokeWidth={1.75} />
              Solo publica propiedades &quot;Propias BC&quot;
            </span>
          )}
        </div>

        {/* Barra de herramientas */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-ink/10 bg-white/85 px-3 py-2 text-sm transition focus-within:border-gold/55">
            <Search size={15} strokeWidth={1.75} className="text-ink/45" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por título, zona o referencia…"
              className="w-full bg-transparent text-ink placeholder:text-ink/40 focus:outline-none"
            />
          </label>

          <select
            value={operation}
            onChange={(e) => setOperation(e.target.value as typeof operation)}
            className="rounded-lg border border-ink/10 bg-white/85 px-3 py-2 text-[13px] text-ink focus:border-gold/55 focus:outline-none"
          >
            <option value="">Todas las operaciones</option>
            <option value="rent">Alquiler</option>
            <option value="sale">Venta</option>
          </select>

          {/* Botón clave API */}
          <button
            type="button"
            onClick={() => setShowApiKeyModal(true)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition",
              apiKey
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
            )}
          >
            <Key size={13} strokeWidth={1.75} />
            {apiKey ? "Clave configurada ✓" : "Configurar clave API"}
          </button>

          {selected.size > 0 && (
            <button
              type="button"
              onClick={publishSelected}
              disabled={isBulkPublishing}
              className="flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-cream-50 transition hover:bg-ink/80 disabled:opacity-50"
            >
              {isBulkPublishing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} strokeWidth={1.75} />
              )}
              Volcar {selected.size} a Idealista
            </button>
          )}

          {bulkMessage && (
            <span
              className={cn(
                "rounded-lg px-3 py-2 text-[11px] font-medium",
                bulkMessage.type === "success"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-100 text-red-700",
              )}
            >
              {bulkMessage.text}
            </span>
          )}

          <span className="ml-auto text-[11px] text-ink/55">
            {filtered.length} propiedades
            {selected.size > 0 && ` · ${selected.size} seleccionadas`}
          </span>
        </div>

        {/* Tabla */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[780px] border-separate border-spacing-y-1.5 text-left text-sm">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
                <th className="px-3 pb-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 cursor-pointer accent-gold"
                  />
                </th>
                <th className="px-3 pb-2">Propiedad</th>
                <th className="px-3 pb-2">Operación</th>
                <th className="px-3 pb-2">Precio</th>
                <th className="px-3 pb-2">Ref.</th>
                <th className="px-3 pb-2">Fecha</th>
                <th className="px-3 pb-2 text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const state = publishStates[p.id];
                const isLoading = state?.status === "loading";
                const isSuccess = state?.status === "success";
                const isError = state?.status === "error";

                return (
                  <tr
                    key={p.id}
                    className={cn(
                      "transition",
                      selected.has(p.id)
                        ? "bg-gold/8"
                        : "bg-white/55 hover:bg-white/85",
                    )}
                  >
                    <td className="rounded-l-xl px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="h-4 w-4 cursor-pointer accent-gold"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        {p.cover_photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.cover_photo_url}
                            alt=""
                            className="h-10 w-14 shrink-0 rounded-md object-cover"
                          />
                        ) : (
                          <div className="h-10 w-14 shrink-0 rounded-md bg-ink/5" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink max-w-[220px]">
                            {p.title}
                          </p>
                          <p className="text-[11px] text-ink/55">{p.zone ?? "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-md border border-ink/10 px-2 py-0.5 text-[11px] font-medium text-ink/70">
                        {p.operation === "rent" ? "Alquiler" : "Venta"}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium text-ink">
                      {p.price != null
                        ? `${formatPrice(Number(p.price))}${p.operation === "rent" ? "/mes" : ""}`
                        : "—"}
                    </td>
                    <td className="px-3 py-3 text-[12px] text-ink/60">
                      <div className="flex flex-col gap-1">
                        <span>{p.bc_reference ?? p.external_id ?? "—"}</span>
                        <span className={cn(
                          "inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
                          SOURCE_STYLE[getSource(p)]
                        )}>
                          {SOURCE_LABEL[getSource(p)]}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[12px] text-ink/60">
                      {DATE_FMT.format(new Date(p.created_at))}
                    </td>
                    <td className="rounded-r-xl px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setEditingIdealistaProperty(p)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-3 py-1.5 text-[11px] font-medium text-gold-dark transition hover:bg-gold/20"
                      >
                        <ImagePlus size={12} strokeWidth={1.75} />
                        Preparar Idealista
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="py-12 text-center text-ink/45">
              No hay propiedades que coincidan con los filtros.
            </div>
          )}
        </div>

        {/* Info API */}
        <div className="mt-4 rounded-xl border border-ink/8 bg-white/50 px-4 py-3 text-[12px] text-ink/55">
          <span className="font-semibold text-ink/70">Volcado a Idealista: </span>
          Las propiedades se envían mediante la API de importación masiva de Idealista.
          Necesitas la clave API que Idealista te entrega como cliente profesional.{" "}
          <a
            href="https://www.idealista.com/news/herramientas/herramientas-para-profesionales"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-gold-dark hover:underline"
          >
            Más información
            <ExternalLink size={11} strokeWidth={1.75} />
          </a>
        </div>
      </section>
    </>
  );
}
