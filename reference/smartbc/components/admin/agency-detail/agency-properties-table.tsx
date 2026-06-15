"use client";

import { ArrowRight, Check, Copy, MessageCircle, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { PLACEHOLDER_GRADIENT } from "@/lib/constants";
import { formatPrice } from "@/lib/format";
import { useT } from "@/lib/i18n/provider";
import { formatRelativeMinutes } from "@/lib/relative-time";
import type { AgencyPropertyRow } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AgencyPropertiesTable({
  properties,
}: {
  properties: AgencyPropertyRow[];
}) {
  const t = useT();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [operationFilter, setOperationFilter] = useState<"" | "alquiler" | "venta">("");
  const [statusFilter, setStatusFilter] = useState<"" | "available" | "reserved" | "rented" | "sold" | "draft">("");
  const [zoneFilter, setZoneFilter] = useState<string>("");
  const [bedroomsFilter, setBedroomsFilter] = useState<string>("");
  const [bathroomsFilter, setBathroomsFilter] = useState<string>("");
  const [floorFilter, setFloorFilter] = useState<string>("");
  const [minM2, setMinM2] = useState<string>("");
  const [maxM2, setMaxM2] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const zoneOptions = useMemo(
    () =>
      Array.from(new Set(properties.map((p) => p.zone))).filter(Boolean).sort(),
    [properties],
  );

  const hasActiveFilters = Boolean(
    operationFilter ||
      statusFilter ||
      zoneFilter ||
      bedroomsFilter ||
      bathroomsFilter ||
      floorFilter ||
      minM2 ||
      maxM2 ||
      query,
  );

  const clearFilters = () => {
    setQuery("");
    setOperationFilter("");
    setStatusFilter("");
    setZoneFilter("");
    setBedroomsFilter("");
    setBathroomsFilter("");
    setFloorFilter("");
    setMinM2("");
    setMaxM2("");
  };

  // Buscador local: filtra por título, referencia o zona sobre las propiedades
  // ya cargadas. Soluciona el "lío" de encontrar un piso concreto entre muchos.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return properties.filter((p) => {
      if (
        q &&
        !p.title.toLowerCase().includes(q) &&
        !p.reference.toLowerCase().includes(q) &&
        !(p.zone?.toLowerCase().includes(q) ?? false)
      ) {
        return false;
      }
      if (operationFilter && p.operation !== operationFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (zoneFilter && p.zone !== zoneFilter) return false;
      if (bedroomsFilter) {
        if (bedroomsFilter.endsWith("plus")) {
          if (p.bedrooms < Number(bedroomsFilter.replace("plus", ""))) return false;
        } else if (p.bedrooms !== Number(bedroomsFilter)) {
          return false;
        }
      }
      if (bathroomsFilter && p.bathrooms < Number(bathroomsFilter)) return false;
      // Planta mínima: sin dato de planta no se puede garantizar el mínimo
      // que exige el cliente, así que esos anuncios quedan fuera.
      if (floorFilter && (p.floor == null || p.floor < Number(floorFilter)))
        return false;
      if (minM2 && p.squareMeters && p.squareMeters < Number(minM2)) return false;
      if (maxM2 && p.squareMeters && p.squareMeters > Number(maxM2)) return false;
      return true;
    });
  }, [
    properties,
    query,
    operationFilter,
    statusFilter,
    zoneFilter,
    bedroomsFilter,
    bathroomsFilter,
    floorFilter,
    minM2,
    maxM2,
  ]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        filtered.forEach((p) => next.delete(p.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((p) => next.add(p.id));
      return next;
    });
  };

  const selectedProps = useMemo(
    () => properties.filter((p) => selected.has(p.id)),
    [properties, selected],
  );

  const shareUrl = (id: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/compartir/${id}`;

  const copyToClipboard = async (text: string, okMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMessage, "success");
    } catch {
      toast("No se pudo copiar al portapapeles", "error");
    }
  };

  const copyUrls = () => {
    const text = selectedProps.map((p) => shareUrl(p.id)).join("\n");
    copyToClipboard(
      text,
      `${selectedProps.length} URL${selectedProps.length === 1 ? "" : "s"} copiada${selectedProps.length === 1 ? "" : "s"}`,
    );
  };

  const copyForClients = () => {
    const text = selectedProps
      .map((p) => {
        const price = `${formatPrice(p.price)} €${p.operation === "alquiler" ? "/mes" : ""}`;
        return `🏠 ${p.title}\n💶 ${price} · ${p.zone}\n🔗 ${shareUrl(p.id)}`;
      })
      .join("\n\n");
    copyToClipboard(text, "Mensaje copiado, listo para enviar");
  };

  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">
          {t("agency.properties.title")}
        </h2>
        <Link
          href="/admin/propiedades"
          className="flex items-center gap-1.5 text-[12px] font-medium text-gold-dark transition hover:text-gold"
        >
          <span>{t("agency.properties.viewAll")}</span>
          <ArrowRight size={13} strokeWidth={1.75} />
        </Link>
      </header>

      {properties.length > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3 py-2">
          <Search size={15} strokeWidth={1.75} className="text-ink/45" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("agency.properties.search")}
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink/40"
          />
        </div>
      )}

      {properties.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <FilterSelect
            label="Operación"
            value={operationFilter}
            onChange={(v) => setOperationFilter(v as typeof operationFilter)}
            options={[
              { value: "", label: "Todas" },
              { value: "alquiler", label: "Alquiler" },
              { value: "venta", label: "Venta" },
            ]}
          />
          <FilterSelect
            label="Estado"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as typeof statusFilter)}
            options={[
              { value: "", label: "Todos" },
              { value: "available", label: "Disponible" },
              { value: "reserved", label: "Reservado" },
              { value: "sold", label: "Vendido" },
              { value: "rented", label: "Alquilado" },
              { value: "draft", label: "Borrador" },
            ]}
          />
          <FilterSelect
            label="Zona"
            value={zoneFilter}
            onChange={setZoneFilter}
            options={[
              { value: "", label: "Todas" },
              ...zoneOptions.map((z) => ({ value: z, label: z })),
            ]}
          />
          <FilterSelect
            label="Dormitorios"
            value={bedroomsFilter}
            onChange={setBedroomsFilter}
            options={[
              { value: "", label: "Todos" },
              { value: "1", label: "Exacto 1" },
              { value: "2", label: "Exacto 2" },
              { value: "3", label: "Exacto 3" },
              { value: "4", label: "Exacto 4" },
              { value: "1plus", label: "1 o más" },
              { value: "2plus", label: "2 o más" },
              { value: "3plus", label: "3 o más" },
              { value: "4plus", label: "4 o más" },
              { value: "5plus", label: "5 o más" },
            ]}
          />
          <FilterSelect
            label="Baños"
            value={bathroomsFilter}
            onChange={setBathroomsFilter}
            options={[
              { value: "", label: "Todos" },
              { value: "1", label: "1+" },
              { value: "2", label: "2+" },
              { value: "3", label: "3+" },
            ]}
          />
          <FilterSelect
            label="Planta"
            value={floorFilter}
            onChange={setFloorFilter}
            options={[
              { value: "", label: "Todas" },
              { value: "1", label: "1ª o más" },
              { value: "2", label: "2ª o más" },
              { value: "3", label: "3ª o más" },
              { value: "4", label: "4ª o más" },
              { value: "5", label: "5ª o más" },
              { value: "6", label: "6ª o más" },
            ]}
          />
          <RangeChip
            label="M²"
            min={minM2}
            max={maxM2}
            onMin={setMinM2}
            onMax={setMaxM2}
          />
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-md border border-ink/15 bg-white px-2.5 py-1 text-[11px] font-medium text-ink/65 transition hover:border-rose-300 hover:text-rose-700"
            >
              Limpiar filtros
            </button>
          )}
          <span
            className={cn(
              "ml-auto rounded-md border px-2.5 py-1 text-[11px] font-semibold",
              hasActiveFilters
                ? "border-gold/40 bg-gold/10 text-gold-dark"
                : "border-ink/10 bg-white/70 text-ink/60",
            )}
          >
            {hasActiveFilters
              ? `${filtered.length} resultado${filtered.length === 1 ? "" : "s"} de ${properties.length}`
              : `${properties.length} propiedades`}
          </span>
        </div>
      )}

      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-gold/35 bg-gold/10 px-3 py-2">
          <span className="text-[12px] font-semibold text-gold-dark">
            {selected.size} seleccionada{selected.size === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={copyUrls}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[11px] font-medium text-cream-50 transition hover:bg-ink-soft"
          >
            <Copy size={12} strokeWidth={1.75} className="text-gold" />
            <span>Copiar URLs</span>
          </button>
          <button
            type="button"
            onClick={copyForClients}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-100"
          >
            <MessageCircle size={12} strokeWidth={1.75} />
            <span>Copiar para WhatsApp</span>
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-[11px] font-medium text-ink/65 transition hover:border-rose-300 hover:text-rose-700"
          >
            <X size={12} strokeWidth={1.75} />
            <span>Limpiar selección</span>
          </button>
        </div>
      )}

      {properties.length === 0 ? (
        <p className="mt-6 rounded-xl border border-gold/15 bg-white/40 px-4 py-10 text-center text-sm text-ink/55">
          {t("agency.properties.empty")}
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[860px] border-separate border-spacing-y-1.5 text-left text-sm">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
                <th className="w-10 px-3 pb-2">
                  <SelectCheckbox
                    checked={allFilteredSelected}
                    onChange={toggleAllFiltered}
                    ariaLabel="Seleccionar todas las propiedades filtradas"
                  />
                </th>
                <th className="px-4 pb-2">
                  {t("agency.properties.table.property")}
                </th>
                <th className="px-4 pb-2">
                  {t("agency.properties.table.type")}
                </th>
                <th className="px-4 pb-2">
                  {t("agency.properties.table.zone")}
                </th>
                <th className="px-4 pb-2 text-center">
                  {t("agency.properties.table.bedrooms")}
                </th>
                <th className="px-4 pb-2 text-center">
                  {t("agency.properties.table.bathrooms")}
                </th>
                <th className="px-4 pb-2">
                  {t("agency.properties.table.price")}
                </th>
                <th className="px-4 pb-2">
                  {t("agency.properties.table.lastUpdate")}
                </th>
                <th className="px-4 pb-2 text-right">{/* actions */}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="rounded-xl border border-gold/15 bg-white/40 px-4 py-10 text-center text-ink/55"
                  >
                    {t("agency.properties.empty")}
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <PropertyRow
                    key={p.id}
                    property={p}
                    selected={selected.has(p.id)}
                    onToggleSelect={() => toggleOne(p.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PropertyRow({
  property,
  selected = false,
  onToggleSelect,
}: {
  property: AgencyPropertyRow;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const t = useT();
  const isRent = property.operation === "alquiler";
  const formatted = formatPrice(property.price);
  const priceLabel = isRent
    ? t("agency.properties.price.rent", { price: `${formatted} €` })
    : t("agency.properties.price.sale", { price: `${formatted} €` });

  return (
    <tr
      className={cn(
        "transition",
        selected ? "bg-gold/10 hover:bg-gold/15" : "bg-white/55 hover:bg-white/85",
      )}
    >
      <td className="px-3 py-3">
        <SelectCheckbox
          checked={selected}
          onChange={() => onToggleSelect?.()}
          ariaLabel={`Seleccionar ${property.title}`}
        />
      </td>
      <td className="rounded-l-xl px-4 py-3">
        <div className="flex items-center gap-3">
          {property.coverPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={property.coverPhotoUrl}
              alt=""
              loading="lazy"
              className="h-12 w-16 shrink-0 rounded-md object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="h-12 w-16 shrink-0 rounded-md"
              style={{ backgroundImage: PLACEHOLDER_GRADIENT }}
            />
          )}
          <div>
            <p className="font-medium text-ink">{property.title}</p>
            <p className="text-[11px] text-ink/55">
              {t("agency.properties.ref", { ref: property.reference })}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
            isRent
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-amber-200 bg-amber-50 text-amber-700",
          )}
        >
          {isRent
            ? t("filters.operation.rent")
            : t("filters.operation.sale")}
        </span>
      </td>
      <td className="px-4 py-3 text-ink/75">{property.zone}</td>
      <td className="px-4 py-3 text-center font-medium text-ink">
        {property.bedrooms}
      </td>
      <td className="px-4 py-3 text-center font-medium text-ink">
        {property.bathrooms}
      </td>
      <td className="px-4 py-3 font-semibold text-ink">{priceLabel}</td>
      <td className="px-4 py-3 text-[12px] text-ink/65">
        {formatRelativeMinutes(property.lastUpdateMinutes, t)}
      </td>
      <td className="rounded-r-xl px-4 py-3 text-right">
        <Link
          href={`/admin/propiedades/${property.id}`}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-[12px] font-medium text-cream-50 transition hover:bg-ink-soft"
        >
          <span>{t("agency.properties.table.viewDetails")}</span>
          <ArrowRight size={13} strokeWidth={1.75} className="text-gold" />
        </Link>
      </td>
    </tr>
  );
}

function SelectCheckbox({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={cn(
        "flex h-[18px] w-[18px] items-center justify-center rounded border transition",
        checked
          ? "border-gold bg-gold text-ink"
          : "border-ink/25 bg-white hover:border-gold/60",
      )}
    >
      {checked && <Check size={12} strokeWidth={3} />}
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-md border border-ink/10 bg-white/85 px-2 py-1 text-ink/75 transition focus-within:border-gold/55">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/45">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent text-[12px] text-ink focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RangeChip({
  label,
  min,
  max,
  onMin,
  onMax,
}: {
  label: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
}) {
  const sanitize = (v: string) => v.replace(/[^\d]/g, "");
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-ink/10 bg-white/85 px-2 py-1 text-ink/75 transition focus-within:border-gold/55">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/45">
        {label}
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={min}
        onChange={(e) => onMin(sanitize(e.target.value))}
        placeholder="mín"
        className="w-12 bg-transparent text-[12px] text-ink placeholder:text-ink/35 focus:outline-none"
      />
      <span className="text-ink/35">–</span>
      <input
        type="text"
        inputMode="numeric"
        value={max}
        onChange={(e) => onMax(sanitize(e.target.value))}
        placeholder="máx"
        className="w-14 bg-transparent text-[12px] text-ink placeholder:text-ink/35 focus:outline-none"
      />
    </div>
  );
}
