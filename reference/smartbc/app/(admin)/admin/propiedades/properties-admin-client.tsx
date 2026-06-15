"use client";

import {
  Archive,
  Check,
  ChevronDown,
  Copy,
  Eye,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveProperty } from "@/app/(admin)/admin/propiedades/actions";
import {
  type AgencyOption,
  NewPropertyModal,
} from "@/components/admin/new-property-modal";
import { PropertyPhotosModal } from "@/components/admin/property-photos-modal";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { PLACEHOLDER_GRADIENT } from "@/lib/constants";
import { formatPrice } from "@/lib/format";
import { useT } from "@/lib/i18n/provider";
import { canAccess } from "@/lib/permissions";
import type { AdminProperty, AdminPropertyStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<AdminPropertyStatus, string> = {
  available: "border-emerald-200 bg-emerald-50 text-emerald-700",
  reserved: "border-amber-200 bg-amber-50 text-amber-700",
  rented: "border-blue-200 bg-blue-50 text-blue-700",
  sold: "border-violet-200 bg-violet-50 text-violet-700",
  draft: "border-ink/15 bg-ink/5 text-ink/55",
};

export function PropertiesAdminClient({
  properties,
  agencies,
  currentRole,
}: {
  properties: AdminProperty[];
  agencies: AgencyOption[];
  currentRole?: string;
}) {
  const t = useT();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [operationFilter, setOperationFilter] = useState<"" | "alquiler" | "venta">("");
  const [statusFilter, setStatusFilter] = useState<"" | "available" | "reserved" | "sold" | "rented" | "draft">("");
  const [zoneFilter, setZoneFilter] = useState<string>("");
  const [subzoneFilter, setSubzoneFilter] = useState<string>("");
  const [agencyFilter, setAgencyFilter] = useState<string>("");
  const [stayFilter, setStayFilter] = useState<"" | "larga" | "corta">("");
  const [bedroomsFilter, setBedroomsFilter] = useState<string>("");
  const [bathroomsFilter, setBathroomsFilter] = useState<string>("");
  const [floorFilter, setFloorFilter] = useState<string>("");
  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [minM2, setMinM2] = useState<string>("");
  const [maxM2, setMaxM2] = useState<string>("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);

  // Opciones únicas para los selects de zona y agencia, derivadas del
  // listado actual. Ordenadas alfabéticamente.
  const zoneOptions = useMemo(
    () =>
      Array.from(new Set(properties.map((p) => p.zone))).filter(Boolean).sort(),
    [properties],
  );
  // Subzonas disponibles dentro del distrito seleccionado.
  const subzoneOptions = useMemo(
    () =>
      zoneFilter
        ? Array.from(
            new Set(
              properties
                .filter((p) => p.zone === zoneFilter && p.subzone)
                .map((p) => p.subzone as string),
            ),
          ).sort((a, b) => a.localeCompare(b, "es"))
        : [],
    [properties, zoneFilter],
  );
  const agencyOptions = useMemo(
    () =>
      Array.from(
        new Map(
          properties.map((p) => [p.agencyId, p.agencyName]),
        ).entries(),
      )
        .filter(([id]) => Boolean(id))
        .sort((a, b) => a[1].localeCompare(b[1])),
    [properties],
  );

  // Cerrar el menú al hacer click fuera o al pulsar Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return properties.filter((p) => {
      if (
        q &&
        !p.title.toLowerCase().includes(q) &&
        !p.reference.toLowerCase().includes(q) &&
        !(p.bcReference?.toLowerCase().includes(q) ?? false) &&
        !(p.zone?.toLowerCase().includes(q) ?? false)
      ) {
        return false;
      }
      if (operationFilter && p.operation !== operationFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (zoneFilter && p.zone !== zoneFilter) return false;
      if (subzoneFilter && p.subzone !== subzoneFilter) return false;
      if (agencyFilter && p.agencyId !== agencyFilter) return false;
      if (stayFilter && p.stayType !== stayFilter) return false;
      if (bedroomsFilter) {
        // "3" = exactamente 3 · "3plus" = 3 o más
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
      if (minPrice && p.price < Number(minPrice)) return false;
      if (maxPrice && p.price > Number(maxPrice)) return false;
      if (minM2 && p.squareMeters < Number(minM2)) return false;
      if (maxM2 && p.squareMeters > Number(maxM2)) return false;
      return true;
    });
  }, [
    properties,
    query,
    operationFilter,
    statusFilter,
    zoneFilter,
    subzoneFilter,
    agencyFilter,
    stayFilter,
    bedroomsFilter,
    bathroomsFilter,
    floorFilter,
    minPrice,
    maxPrice,
    minM2,
    maxM2,
  ]);

  // Paginación: solo renderizamos una página de la tabla (DOM acotado).
  const PER_PAGE = 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  // Al cambiar cualquier filtro/búsqueda, volver a la primera página.
  useEffect(() => {
    setPage(1);
  }, [
    query,
    operationFilter,
    statusFilter,
    zoneFilter,
    subzoneFilter,
    agencyFilter,
    stayFilter,
    bedroomsFilter,
    bathroomsFilter,
    floorFilter,
    minPrice,
    maxPrice,
    minM2,
    maxM2,
  ]);

  const hasActiveFilters = Boolean(
    operationFilter ||
      statusFilter ||
      zoneFilter ||
      subzoneFilter ||
      agencyFilter ||
      stayFilter ||
      bedroomsFilter ||
      bathroomsFilter ||
      floorFilter ||
      minPrice ||
      maxPrice ||
      minM2 ||
      maxM2 ||
      query,
  );

  const clearFilters = () => {
    setQuery("");
    setOperationFilter("");
    setStatusFilter("");
    setZoneFilter("");
    setSubzoneFilter("");
    setAgencyFilter("");
    setStayFilter("");
    setBedroomsFilter("");
    setBathroomsFilter("");
    setFloorFilter("");
    setMinPrice("");
    setMaxPrice("");
    setMinM2("");
    setMaxM2("");
  };

  // --- Selección múltiple para copiar URLs y enviarlas a clientes ---
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
        // Deseleccionar solo las filtradas (conserva selecciones de otros filtros)
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

  // Formato listo para pegar en WhatsApp/email: título · precio · enlace
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
    <section className="mt-5 rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex w-full max-w-md items-center gap-2 rounded-xl border border-ink/10 bg-white/85 px-3 py-2 text-sm transition focus-within:border-gold/55">
          <Search size={15} strokeWidth={1.75} className="text-ink/45" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por título, ref. BC, ref. portal o zona…"
            className="w-full bg-transparent text-ink placeholder:text-ink/40 focus:outline-none"
          />
        </label>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-cream-50 transition hover:bg-ink-soft"
          >
            <Plus size={14} strokeWidth={1.75} className="text-gold" />
            <span>{t("adminProps.add")}</span>
            <ChevronDown
              size={13}
              strokeWidth={1.75}
              className={cn(
                "transition",
                menuOpen ? "rotate-180" : "rotate-0",
              )}
            />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-10 mt-2 w-64 overflow-hidden rounded-xl border border-gold/20 bg-cream-50 shadow-[0_15px_40px_-15px_rgba(40,28,10,0.4)]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setModalOpen(true);
                }}
                className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm text-ink transition hover:bg-gold/10"
              >
                <Pencil
                  size={15}
                  strokeWidth={1.75}
                  className="mt-0.5 shrink-0 text-gold-dark"
                />
                <div>
                  <p className="font-medium">{t("adminProps.add.manual")}</p>
                  <p className="text-[11px] text-ink/55">
                    {t("adminProps.add.manual.help")}
                  </p>
                </div>
              </button>
              {/* "Importar por link" navega a la página dedicada
                  /admin/propiedades/importar (Idealista / Fotocasa / Inmoweb). */}
              <Link
                href="/admin/propiedades/importar"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-start gap-3 border-t border-gold/10 px-4 py-3 text-left text-sm text-ink transition hover:bg-gold/10"
              >
                <LinkIcon
                  size={15}
                  strokeWidth={1.75}
                  className="mt-0.5 shrink-0 text-gold-dark"
                />
                <div>
                  <p className="font-medium">{t("adminProps.add.byLink")}</p>
                  <p className="text-[11px] text-ink/55">
                    {t("adminProps.add.byLink.help")}
                  </p>
                </div>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Filtros: operación, estado, zona, agencia. Aparecen siempre — el
          listado puede tener cientos de propiedades y el buscador de texto
          no basta para acotar por categoría. */}
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
          label="Distrito"
          value={zoneFilter}
          onChange={(v) => {
            setZoneFilter(v);
            setSubzoneFilter(""); // al cambiar de distrito, reiniciar subzona
          }}
          options={[
            { value: "", label: "Todas" },
            ...zoneOptions.map((z) => ({ value: z, label: z })),
          ]}
        />
        {subzoneOptions.length > 0 && (
          <FilterSelect
            label="Subzona"
            value={subzoneFilter}
            onChange={setSubzoneFilter}
            options={[
              { value: "", label: "Todo el distrito" },
              ...subzoneOptions.map((s) => ({ value: s, label: s })),
            ]}
          />
        )}
        <FilterSelect
          label="Agencia"
          value={agencyFilter}
          onChange={setAgencyFilter}
          options={[
            { value: "", label: "Todas" },
            ...agencyOptions.map(([id, name]) => ({ value: id, label: name })),
          ]}
        />
        <FilterSelect
          label="Estancia"
          value={stayFilter}
          onChange={(v) => setStayFilter(v as typeof stayFilter)}
          options={[
            { value: "", label: "Todas" },
            { value: "larga", label: "Larga" },
            { value: "corta", label: "Corta" },
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
        <PriceRange
          min={minPrice}
          max={maxPrice}
          onMin={setMinPrice}
          onMax={setMaxPrice}
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

      {/* Barra de selección: copiar URLs para enviar a clientes */}
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

      <NewPropertyModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        agencies={agencies}
      />

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[1200px] border-separate border-spacing-y-1.5 text-left text-sm">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
              <th className="w-10 px-3 pb-2">
                <SelectCheckbox
                  checked={allFilteredSelected}
                  onChange={toggleAllFiltered}
                  ariaLabel="Seleccionar todas las propiedades filtradas"
                />
              </th>
              <th className="px-3 pb-2">{t("adminProps.table.property")}</th>
              <th className="px-3 pb-2">{t("adminProps.table.reference")}</th>
              <th className="px-3 pb-2">{t("adminProps.table.agency")}</th>
              <th className="px-3 pb-2">{t("adminProps.table.zone")}</th>
              <th className="px-3 pb-2">{t("adminProps.table.operation")}</th>
              <th className="px-3 pb-2 text-center">
                {t("adminProps.table.size")}
              </th>
              <th className="px-3 pb-2">{t("adminProps.table.price")}</th>
              <th className="px-3 pb-2">{t("adminProps.table.status")}</th>
              <th className="px-3 pb-2">
                {t("adminProps.table.published")}
              </th>
              <th className="px-3 pb-2 text-right">
                {t("adminProps.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className="rounded-xl border border-gold/15 bg-white/40 px-4 py-10 text-center text-ink/55"
                >
                  {t("adminProps.empty")}
                </td>
              </tr>
            ) : (
              paged.map((p) => (
                <PropertyRow
                  key={p.id}
                  property={p}
                  canEdit={!currentRole || canAccess(currentRole, "properties", "edit")}
                  selected={selected.has(p.id)}
                  onToggleSelect={() => toggleOne(p.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
      )}
    </section>
  );
}

function PropertyRow({
  property,
  canEdit = true,
  selected = false,
  onToggleSelect,
}: {
  property: AdminProperty;
  canEdit?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const t = useT();
  const [photosOpen, setPhotosOpen] = useState(false);
  const isRent = property.operation === "alquiler";
  const formatted = formatPrice(property.price);
  const cover = property.coverPhotoUrl ?? property.photos?.[0]?.url ?? null;

  return (
    <tr
      className={cn(
        "transition",
        selected ? "bg-gold/10 hover:bg-gold/15" : "bg-white/55 hover:bg-white/85",
      )}
    >
      <td className="rounded-l-xl px-3 py-3">
        <SelectCheckbox
          checked={selected}
          onChange={() => onToggleSelect?.()}
          ariaLabel={`Seleccionar ${property.title}`}
        />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPhotosOpen(true)}
            aria-label={t("adminProps.photos.manage")}
            className="relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-gold/15 transition hover:border-gold/55"
            style={cover ? undefined : { backgroundImage: PLACEHOLDER_GRADIENT }}
          >
            {cover ? (
              <Image
                src={cover}
                alt=""
                fill
                sizes="64px"
                className="object-cover"
              />
            ) : (
              <ImageIcon
                size={14}
                strokeWidth={1.75}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-ink/45"
              />
            )}
          </button>
          <div>
            <p className="flex items-center gap-2 font-medium text-ink">
              {property.title}
              {property.featured && (
                <span className="rounded-md border border-gold/35 bg-gold/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gold-dark">
                  {t("adminProps.featured.badge")}
                </span>
              )}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink/55">
              {property.bcReference && (
                <span className="rounded-md border border-gold/30 bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-gold-dark">
                  {property.bcReference}
                </span>
              )}
              <span>
                {t("agency.properties.ref", { ref: property.reference })}
              </span>
            </p>
          </div>
        </div>
        <PropertyPhotosModal
          open={photosOpen}
          onClose={() => setPhotosOpen(false)}
          slug={property.id}
          title={property.title}
          initialPhotos={property.photos ?? []}
        />
      </td>
      <td className="px-3 py-3">
        <span className="inline-block rounded-md border border-ink/10 bg-ink/5 px-2 py-1 font-mono text-[10px] font-semibold tracking-wider text-ink/80">
          {property.propertyReference ?? "—"}
        </span>
      </td>
      <td className="px-3 py-3 text-ink/75">{property.agencyName || "—"}</td>
      <td className="px-3 py-3 text-ink/75">{property.zone}</td>
      <td className="px-3 py-3">
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
      <td className="px-3 py-3 text-center text-[12px] text-ink/75">
        {property.bedrooms} / {property.bathrooms} / {property.squareMeters}
      </td>
      <td className="px-3 py-3 font-semibold text-ink">
        {formatted} €{isRent ? " /mes" : ""}
      </td>
      <td className="px-3 py-3">
        <span
          className={cn(
            "rounded-md border px-2.5 py-1 text-[11px] font-medium",
            STATUS_STYLES[property.status],
          )}
        >
          {t(`adminProps.status.${property.status}`)}
        </span>
      </td>
      <td className="px-3 py-3 text-[12px] text-ink/65">
        {property.publishedLabel}
      </td>
      <td className="rounded-r-xl px-3 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          <a
            href={`/compartir/${property.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-[11px] font-medium text-ink/75 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
          >
            <Eye size={12} strokeWidth={1.75} />
            <span>{t("adminProps.view")}</span>
          </a>
          {canEdit ? (
            <Link
              href={`/admin/propiedades/${property.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-1.5 text-[11px] font-medium text-cream-50 transition hover:bg-ink-soft"
            >
              <Pencil size={12} strokeWidth={1.75} className="text-gold" />
              <span>{t("adminProps.edit")}</span>
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-ink/20 px-3 py-1.5 text-[11px] font-medium text-ink/40"
              title="Sin permiso para editar"
            >
              <Pencil size={12} strokeWidth={1.75} />
              <span>{t("adminProps.edit")}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setPhotosOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-[11px] font-medium text-ink/75 transition hover:border-gold/55 hover:text-ink"
          >
            <ImageIcon size={12} strokeWidth={1.75} className="text-gold" />
            <span>
              {t("adminProps.photos.action", {
                count: property.photos?.length ?? 0,
              })}
            </span>
          </button>
          <ArchiveButton slug={property.id} />
        </div>
      </td>
    </tr>
  );
}

function ArchiveButton({ slug }: { slug: string }) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleArchive = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("adminProps.archive.confirm"))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await archiveProperty({ slug });
      if (result.ok) {
        router.refresh();
      } else if (typeof window !== "undefined") {
        window.alert(`${t("adminProps.archive.error")} · ${result.error}`);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleArchive}
      disabled={isPending}
      className="inline-flex items-center gap-2 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-[11px] font-medium text-ink/70 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isPending ? (
        <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
      ) : (
        <Archive size={12} strokeWidth={1.75} />
      )}
      <span>{t("adminProps.archive.action")}</span>
    </button>
  );
}

// Checkbox de selección con estilo de marca (cuadrado dorado al marcar).
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

// Chip de rango numérico genérico (mismo estilo que PriceRange).
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

// Rango de precio: dos inputs numéricos (min – max €) con el mismo estilo de
// chip que FilterSelect. Vacío = sin límite por ese lado.
function PriceRange({
  min,
  max,
  onMin,
  onMax,
}: {
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
}) {
  const sanitize = (v: string) => v.replace(/[^\d]/g, "");
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-ink/10 bg-white/85 px-2 py-1 text-ink/75 transition focus-within:border-gold/55">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/45">
        Precio €
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
