"use client";

import { ArrowLeft, Edit2, Loader2, Search, Sparkles } from "lucide-react";
import { useState, useMemo } from "react";
import { IdealistaForm, type IdealistaListing } from "../publicacion/idealista-form";
import { cn } from "@/lib/utils";

type Property = {
  id: string;
  slug: string;
  title: string;
  zone: string | null;
  price: number | null;
  operation: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_meters: number | null;
  status: string | null;
  cover_photo_url: string | null;
  bc_reference: string | null;
  created_at: string;
};

type DbIdealistaListing = {
  id: string;
  property_id: string | null;
  is_inspo: boolean;
  inspo_title: string | null;
  reference_code: string | null;
  property_type: string | null;
  address_street: string | null;
  address_number: string | null;
  address_postal_code: string | null;
  address_city: string | null;
  address_block: string | null;
  address_door: string | null;
  address_visibility: string | null;
  square_meters: number | null;
  built_square_meters: number | null;
  floor: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  condition: string | null;
  price: number | null;
  total_rental_price: number | null;
  rental_type: string | null;
  max_tenants: number | null;
  pets_allowed: boolean;
  children_recommended: boolean;
  equipment_type: string | null;
  windows_location: string | null;
  has_elevator: boolean;
  orientation_north: boolean;
  orientation_south: boolean;
  orientation_east: boolean;
  orientation_west: boolean;
  has_terrace: boolean;
  has_balcony: boolean;
  has_parking: boolean;
  has_storage: boolean;
  has_pool: boolean;
  has_garden: boolean;
  has_wardrobes: boolean;
  has_ac: boolean;
  is_penthouse: boolean;
  is_studio: boolean;
  is_duplex: boolean;
  energy_class: string | null;
  energy_performance: number | null;
  emission_rating: string | null;
  emission_value: number | null;
  contact_id: string | null;
  notes: string | null;
  photo_ids: string[];
  video_ids: string[];
  plan_ids: string[];
  idealista_property_id: string | null;
  idealista_state: string | null;
  created_at: string;
  updated_at: string;
};

function listingToInitialData(
  listing: DbIdealistaListing,
  propertyId: string
): Partial<IdealistaListing> {
  return {
    propertyId,
    isInspo: listing.is_inspo,
    inspoTitle: listing.inspo_title ?? "",
    referenceCode: listing.reference_code ?? "",
    propertyType: listing.property_type ?? "flat",
    addressStreet: listing.address_street ?? "",
    addressNumber: listing.address_number ?? "",
    addressPostalCode: listing.address_postal_code ?? "",
    addressCity: listing.address_city ?? "",
    addressBlock: listing.address_block ?? "",
    addressDoor: listing.address_door ?? "",
    addressVisibility: (listing.address_visibility ?? "exact") as
      | "exact"
      | "street"
      | "hidden",
    squareMeters: listing.square_meters ?? 0,
    builtSquareMeters: listing.built_square_meters ?? 0,
    floor: listing.floor ?? "",
    bedrooms: listing.bedrooms ?? 0,
    bathrooms: listing.bathrooms ?? 0,
    condition: (listing.condition ?? "good") as
      | "good"
      | "to-reform"
      | "needs-reform"
      | "new",
    price: listing.price ?? 0,
    totalRentalPrice: listing.total_rental_price ?? 0,
    rentalType: (listing.rental_type ?? "residential") as
      | "residential"
      | "temporary",
    maxTenants: listing.max_tenants ?? 0,
    petsAllowed: listing.pets_allowed,
    childrenRecommended: listing.children_recommended,
    equipmentType: (listing.equipment_type ?? "unknown") as
      | "furnished"
      | "kitchen-only"
      | "empty"
      | "unknown",
    windowsLocation: (listing.windows_location ?? "exterior") as
      | "interior"
      | "exterior",
    hasElevator: listing.has_elevator,
    orientationNorth: listing.orientation_north,
    orientationSouth: listing.orientation_south,
    orientationEast: listing.orientation_east,
    orientationWest: listing.orientation_west,
    hasTerrace: listing.has_terrace,
    hasBalcony: listing.has_balcony,
    hasParking: listing.has_parking,
    hasStorage: listing.has_storage,
    hasPool: listing.has_pool,
    hasGarden: listing.has_garden,
    hasWardrobes: listing.has_wardrobes,
    hasAC: listing.has_ac,
    isPenthouse: listing.is_penthouse,
    isStudio: listing.is_studio,
    isDuplex: listing.is_duplex,
    energyClass: listing.energy_class ?? "",
    energyPerformance: listing.energy_performance ?? 0,
    emissionRating: listing.emission_rating ?? "",
    emissionValue: listing.emission_value ?? 0,
    contactId: listing.contact_id ?? "",
    notes: listing.notes ?? "",
    photos: listing.photo_ids ?? [],
    videos: listing.video_ids ?? [],
    plans: listing.plan_ids ?? [],
  };
}

export function IdealistaClient({
  properties,
  listings,
}: {
  properties: Property[];
  listings: DbIdealistaListing[];
}) {
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [isInspoMode, setIsInspoMode] = useState(false);
  const [editingInspoId, setEditingInspoId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === selectedPropertyId),
    [selectedPropertyId, properties]
  );

  const selectedListing = useMemo(
    () => listings.find((l) => l.property_id === selectedPropertyId),
    [selectedPropertyId, listings]
  );

  const inspoListing = useMemo(
    () => listings.find((l) => l.id === editingInspoId),
    [editingInspoId, listings]
  );

  const filteredProperties = useMemo(() => {
    const query = searchTerm.toLowerCase();
    return properties.filter(
      (p) =>
        p.title.toLowerCase().includes(query) ||
        p.zone?.toLowerCase().includes(query) ||
        p.bc_reference?.toLowerCase().includes(query)
    );
  }, [properties, searchTerm]);

  const inspoListings = useMemo(
    () => listings.filter((l) => l.is_inspo),
    [listings]
  );
  const systemListings = useMemo(
    () => listings.filter((l) => !l.is_inspo),
    [listings]
  );

  function clearForm() {
    setSelectedPropertyId(null);
    setIsInspoMode(false);
    setEditingInspoId(null);
    setError(null);
  }

  const handleSave = async (data: IdealistaListing) => {
    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch("/api/admin/publicacion/save-idealista-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Error al guardar");
      }
      clearForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido al guardar");
    } finally {
      setIsSaving(false);
    }
  };

  // ── Vista de formulario (propiedad existente o inspo) ─────────────────────
  const showingForm = (selectedPropertyId && selectedProperty) || isInspoMode || editingInspoId;

  if (showingForm) {
    const isInspo = isInspoMode || inspoListing?.is_inspo;
    const propertyId = selectedPropertyId ?? editingInspoId ?? `inspo-${Date.now()}`;
    const propertyTitle = isInspo
      ? (inspoListing?.inspo_title ?? "")
      : (selectedProperty?.title ?? "");
    const initialData =
      selectedListing
        ? listingToInitialData(selectedListing, propertyId)
        : inspoListing
        ? listingToInitialData(inspoListing, inspoListing.id)
        : undefined;

    return (
      <div className="space-y-6">
        <button
          onClick={clearForm}
          className="flex items-center gap-2 text-sm font-medium text-ink/60 hover:text-ink transition"
        >
          <ArrowLeft size={16} />
          Volver
        </button>

        {isSaving && (
          <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <Loader2 size={14} className="animate-spin" />
            Guardando...
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Error: {error}
          </div>
        )}

        <IdealistaForm
          propertyId={propertyId}
          propertyTitle={propertyTitle}
          isInspo={!!isInspo}
          initialData={initialData}
          onSave={handleSave}
        />
      </div>
    );
  }

  // ── Vista principal (dos modos) ───────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Cabecera de modos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Modo 1: propiedad del sistema */}
        <div className="rounded-xl border border-ink/10 bg-white/60 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Search size={15} className="text-ink/50" />
            <h3 className="text-sm font-semibold text-ink">Propiedad existente</h3>
          </div>
          <p className="text-xs text-ink/50 mb-3">
            Busca una propiedad ya creada en el sistema y prepara su ficha para Idealista.
          </p>
          <div className="relative">
            <input
              type="text"
              placeholder="Buscar por nombre, zona, referencia..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-gold/55 focus:outline-none"
            />
          </div>
        </div>

        {/* Modo 2: inspo */}
        <button
          onClick={() => setIsInspoMode(true)}
          className="rounded-xl border-2 border-dashed border-gold/40 bg-gold/5 p-4 text-left transition hover:border-gold/70 hover:bg-gold/10 group"
        >
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={15} className="text-gold" />
            <h3 className="text-sm font-semibold text-ink">Nueva Inspo</h3>
          </div>
          <p className="text-xs text-ink/50">
            Crea una ficha desde cero para publicar en Idealista, sin necesidad de tener la propiedad en el sistema.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 rounded-lg bg-gold/20 px-3 py-1 text-xs font-semibold text-gold group-hover:bg-gold/30 transition">
            + Crear inspo
          </span>
        </button>
      </div>

      {/* Lista de propiedades del sistema (si hay búsqueda o siempre visible) */}
      {filteredProperties.length > 0 && (
        <div className="rounded-xl border border-ink/8 bg-white/40 overflow-hidden">
          <div className="max-h-[400px] overflow-y-auto divide-y divide-ink/6">
            {filteredProperties.map((property) => {
              const listing = systemListings.find((l) => l.property_id === property.id);
              return (
                <div
                  key={property.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gold/5 transition"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {property.title}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink/50">
                      {property.zone && <span>{property.zone}</span>}
                      {property.price && (
                        <span className="font-semibold text-gold">
                          {new Intl.NumberFormat("es-ES", {
                            style: "currency",
                            currency: "EUR",
                            maximumFractionDigits: 0,
                          }).format(property.price)}
                        </span>
                      )}
                      {listing && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          ✓ Preparada
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedPropertyId(property.id)}
                    className="shrink-0 rounded-lg border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold transition hover:bg-gold/20"
                  >
                    {listing ? "Editar" : "Preparar →"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fichas preparadas: del sistema + inspo */}
      {listings.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/45">
            Fichas guardadas ({listings.length})
          </h3>
          <div className="space-y-2">
            {listings.map((listing) => {
              const property = !listing.is_inspo
                ? properties.find((p) => p.id === listing.property_id)
                : null;
              const displayTitle = listing.is_inspo
                ? (listing.inspo_title || "Inspo sin título")
                : (property?.title ?? "Propiedad eliminada");

              return (
                <div
                  key={listing.id}
                  className="flex items-center gap-3 rounded-xl border border-gold/15 bg-white/60 px-4 py-3 hover:bg-white/80 transition"
                >
                  {listing.is_inspo && (
                    <Sparkles size={14} className="shrink-0 text-gold" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {displayTitle}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink/50">
                      {listing.square_meters && (
                        <span>{listing.square_meters} m²</span>
                      )}
                      {listing.bedrooms != null && listing.bedrooms > 0 && (
                        <span>{listing.bedrooms} hab.</span>
                      )}
                      {listing.price && (
                        <span>
                          {new Intl.NumberFormat("es-ES", {
                            style: "currency",
                            currency: "EUR",
                            maximumFractionDigits: 0,
                          }).format(listing.price)}
                        </span>
                      )}
                      {listing.reference_code && (
                        <span className="rounded-full bg-blue-100/60 px-2 py-0.5 text-[10px] font-medium text-blue-700 font-mono">
                          {listing.reference_code}
                        </span>
                      )}
                      {listing.idealista_state === "published" ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          ✓ Publicado
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                          Borrador
                        </span>
                      )}
                      <span className="text-ink/30">
                        {new Date(listing.updated_at).toLocaleDateString("es-ES")}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (listing.is_inspo) {
                        setEditingInspoId(listing.id);
                      } else {
                        setSelectedPropertyId(listing.property_id!);
                      }
                    }}
                    className="shrink-0 rounded-lg border border-ink/15 bg-ink/5 p-1.5 text-ink/50 transition hover:bg-ink/10 hover:text-ink"
                    title="Editar"
                  >
                    <Edit2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {listings.length === 0 && filteredProperties.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-ink/40">
            No hay propiedades en el sistema
          </p>
        </div>
      )}
    </div>
  );
}
