"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useEffect } from "react";
import { Image as ImageIcon, Loader2, MapPin, Minus, Plus, Save, Trash2, Video, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const MapPicker = dynamic(() => import("./map-picker"), { ssr: false });

// ── Texto fijo que siempre se agrega al final de la descripción ───────────────
const DESCRIPTION_FOOTER = `\n\nRequisitos: 1 fianza + personal shopper\n\nPara más propiedades consulta por chat de Idealista y WhatsApp y te enviamos más opciones que se acomoden a tus necesidades.`;

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type IdealistaListing = {
  propertyId: string;
  listingId?: string;
  isInspo?: boolean;
  inspoTitle?: string;
  // Tipo
  propertyType: string;
  // Localización
  referenceCode: string;
  addressStreet: string;
  addressNumber: string;
  addressPostalCode: string;
  addressCity: string;
  addressBlock: string;
  addressDoor: string;
  addressVisibility: "exact" | "street" | "hidden";
  latitude: number;
  longitude: number;
  // Características
  squareMeters: number;
  builtSquareMeters: number;
  floor: string;
  bedrooms: number;
  bathrooms: number;
  condition: "good" | "to-reform" | "needs-reform" | "new";
  // Precio
  price: number;
  totalRentalPrice: number;
  rentalType: "residential" | "temporary";
  maxTenants: number;
  petsAllowed: boolean;
  childrenRecommended: boolean;
  // Equipamiento
  equipmentType: "furnished" | "kitchen-only" | "empty" | "unknown";
  windowsLocation: "interior" | "exterior";
  hasElevator: boolean;
  // Orientación
  orientationNorth: boolean;
  orientationSouth: boolean;
  orientationEast: boolean;
  orientationWest: boolean;
  // Extras
  hasTerrace: boolean;
  hasBalcony: boolean;
  hasParking: boolean;
  hasStorage: boolean;
  hasPool: boolean;
  hasGarden: boolean;
  hasWardrobes: boolean;
  hasAC: boolean;
  // Tipos especiales
  isPenthouse: boolean;
  isStudio: boolean;
  isDuplex: boolean;
  // Energía
  energyClass: string;
  energyPerformance: number;
  emissionRating: string;
  emissionValue: number;
  // Descripción
  description: string;
  // Contacto
  contactId: string;
  notes: string;
  // Media (URLs tras subida)
  photos: string[];
  videos: string[];
  plans: string[];
};

const DEFAULTS: Omit<IdealistaListing, "propertyId"> = {
  isInspo: false,
  inspoTitle: "",
  propertyType: "flat",
  referenceCode: "",
  addressStreet: "",
  addressNumber: "",
  addressPostalCode: "",
  addressCity: "",
  addressBlock: "",
  addressDoor: "",
  addressVisibility: "exact",
  latitude: 0,
  longitude: 0,
  squareMeters: 0,
  builtSquareMeters: 0,
  floor: "",
  bedrooms: 0,
  bathrooms: 0,
  condition: "good",
  price: 0,
  totalRentalPrice: 0,
  rentalType: "residential",
  maxTenants: 0,
  petsAllowed: false,
  childrenRecommended: false,
  equipmentType: "unknown",
  windowsLocation: "exterior",
  hasElevator: false,
  orientationNorth: false,
  orientationSouth: false,
  orientationEast: false,
  orientationWest: false,
  hasTerrace: false,
  hasBalcony: false,
  hasParking: false,
  hasStorage: false,
  hasPool: false,
  hasGarden: false,
  hasWardrobes: false,
  hasAC: false,
  isPenthouse: false,
  isStudio: false,
  isDuplex: false,
  energyClass: "",
  energyPerformance: 0,
  emissionRating: "",
  emissionValue: 0,
  description: "",
  contactId: "",
  notes: "",
  photos: [],
  videos: [],
  plans: [],
};

// ── Utilidades ───────────────────────────────────────────────────────────

function generateReferenceCode(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `IDEAL-${year}-${random}`;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

async function geocodeAddress(
  street: string,
  city: string
): Promise<{ lat: number; lon: number } | null> {
  if (!street || !city) return null;

  try {
    const query = `${street}, ${city}`;
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        query
      )}&limit=1`,
      {
        headers: {
          "Accept": "application/json",
          "User-Agent": "smartbc-idealista-form",
        },
      }
    );

    if (!response.ok) return null;

    const results: NominatimResult[] = await response.json();
    if (results.length === 0) return null;

    return {
      lat: parseFloat(results[0].lat),
      lon: parseFloat(results[0].lon),
    };
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
}

// ── Micro-components ──────────────────────────────────────────────────────────────

function SectionHeader({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-3 pb-3 border-b border-ink/8">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold/15 text-[11px] font-bold text-gold">
        {step}
      </span>
      <h3 className="font-serif text-base font-semibold text-ink">{title}</h3>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-ink/55 mb-1">
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-gold/55 focus:outline-none transition";

const selectCls =
  "w-full rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm text-ink focus:border-gold/55 focus:outline-none transition";

function RadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              value === opt.value
                ? "border-gold bg-gold/12 text-ink"
                : "border-ink/12 bg-white text-ink/55 hover:border-ink/25 hover:text-ink"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Chip({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
        checked
          ? "border-gold bg-gold/12 text-ink"
          : "border-ink/12 bg-white text-ink/55 hover:border-ink/25 hover:text-ink"
      )}
    >
      {checked && <span className="mr-1 text-gold">✓</span>}
      {label}
    </button>
  );
}

function Stepper({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/12 bg-white text-ink/55 hover:bg-ink/5 hover:text-ink transition"
        >
          <Minus size={13} />
        </button>
        <span className="w-10 text-center text-sm font-semibold text-ink">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/12 bg-white text-ink/55 hover:bg-ink/5 hover:text-ink transition"
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Componente: Geocoding con Mapa ───────────────────────────────────────

interface GeocodingMapSectionProps {
  street: string;
  city: string;
  latitude: number;
  longitude: number;
  onCoordinatesChange: (lat: number, lng: number) => void;
}

function GeocodingMapSection({
  street,
  city,
  latitude,
  longitude,
  onCoordinatesChange,
}: GeocodingMapSectionProps) {
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Debounce del geocoding
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // No hacer nada si no hay calle y ciudad
    if (!street || !city) {
      setGeocodeError(null);
      return;
    }

    setGeocoding(true);
    setGeocodeError(null);

    debounceTimer.current = setTimeout(async () => {
      const result = await geocodeAddress(street, city);
      if (result) {
        onCoordinatesChange(result.lat, result.lon);
        setGeocodeError(null);
      } else {
        setGeocodeError(
          "No se encontró la dirección. Puedes ajustar el pin manualmente."
        );
      }
      setGeocoding(false);
    }, 800);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [street, city, onCoordinatesChange]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Label>Ubicación exacta en el mapa</Label>
        {geocoding && (
          <span className="flex items-center gap-1 text-[10px] text-ink/50">
            <Loader2 size={10} className="animate-spin" />
            Buscando...
          </span>
        )}
        {latitude !== 0 && longitude !== 0 && !geocoding && (
          <span className="text-[10px] text-ink/40 font-mono">
            {latitude.toFixed(6)}, {longitude.toFixed(6)}
          </span>
        )}
      </div>

      {geocodeError && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">
          <span className="mt-0.5">⚠️</span>
          <span>{geocodeError}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-ink/10">
        <MapPicker
          lat={latitude}
          lng={longitude}
          onChange={(lat, lng) => {
            onCoordinatesChange(lat, lng);
          }}
        />
      </div>
      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ink/40">
        <MapPin size={11} />
        {geocoding
          ? "Detectando ubicación..."
          : "Haz clic en el mapa para marcar la ubicación exacta"}
      </p>
    </div>
  );
}

// ── Media upload ──────────────────────────────────────────────────────────

type MediaItem = { url: string; name?: string };

function MediaUploadZone({
  label,
  items,
  accept,
  icon: Icon,
  onChange,
}: {
  label: string;
  items: string[];
  accept: string;
  icon: React.ElementType;
  onChange: (urls: string[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const uploaded: string[] = [];

    for (const file of Array.from(files)) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/admin/idealista/upload-media", {
          method: "POST",
          body: fd,
        });
        if (res.ok) {
          const { url } = await res.json();
          uploaded.push(url);
        }
      } catch {
        // skip failed file
      }
    }

    onChange([...items, ...uploaded]);
    setUploading(false);
  }

  const isImage = accept.includes("image");

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label>{label}</Label>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 rounded-lg border border-gold/30 bg-gold/8 px-2.5 py-1 text-xs font-medium text-gold transition hover:bg-gold/15 disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Icon size={11} />
          )}
          {uploading ? "Subiendo..." : "Agregar"}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {items.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-ink/12 bg-ink/3 py-6 text-ink/35 transition hover:border-gold/30 hover:bg-gold/5"
        >
          <Icon size={20} />
          <span className="text-xs">Haz clic o arrastra archivos aquí</span>
        </button>
      ) : (
        <div
          className={cn(
            isImage
              ? "grid grid-cols-3 gap-2 sm:grid-cols-4"
              : "space-y-1.5"
          )}
        >
          {items.map((url, i) => (
            <div key={i} className="group relative">
              {isImage ? (
                <div className="aspect-square overflow-hidden rounded-lg border border-ink/10 bg-ink/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-white/60 px-3 py-2">
                  <Icon size={14} className="shrink-0 text-ink/40" />
                  <span className="truncate text-xs text-ink/60">
                    {url.split("/").pop()}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                className={cn(
                  "absolute flex items-center justify-center rounded-full bg-red-500 text-white transition hover:bg-red-600",
                  isImage
                    ? "right-1 top-1 h-5 w-5 opacity-0 group-hover:opacity-100"
                    : "right-2 top-1/2 -translate-y-1/2 h-5 w-5"
                )}
                title="Eliminar"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={cn(
              "flex items-center justify-center rounded-lg border-2 border-dashed border-ink/12 text-ink/30 transition hover:border-gold/30 hover:text-gold disabled:opacity-50",
              isImage ? "aspect-square" : "h-10 w-full"
            )}
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={16} />}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────────

export function IdealistaForm({
  propertyId,
  propertyTitle,
  isInspo = false,
  initialData,
  onSave,
}: {
  propertyId: string;
  propertyTitle?: string;
  isInspo?: boolean;
  initialData?: Partial<IdealistaListing>;
  onSave: (data: IdealistaListing) => Promise<void>;
}) {
  const [form, setForm] = useState<IdealistaListing>({
    ...DEFAULTS,
    ...initialData,
    propertyId,
    isInspo,
  });
  const [saving, setSaving] = useState(false);
  const [showDescPreview, setShowDescPreview] = useState(false);

  function set<K extends keyof IdealistaListing>(
    key: K,
    value: IdealistaListing[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Cabecera */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          {isInspo && (
            <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">
              Inspo
            </span>
          )}
          <p className="text-xs text-ink/45 font-medium uppercase tracking-wide">
            {isInspo ? "Nueva ficha Idealista" : "Preparando ficha para Idealista"}
          </p>
        </div>
        {isInspo ? (
          <input
            type="text"
            value={form.inspoTitle ?? ""}
            onChange={(e) => set("inspoTitle", e.target.value)}
            placeholder="Título de la propiedad..."
            className="mt-1 w-full border-0 border-b border-ink/15 bg-transparent pb-1 font-serif text-xl font-semibold text-ink placeholder:text-ink/25 focus:border-gold/60 focus:outline-none"
          />
        ) : (
          <h2 className="mt-0.5 font-serif text-xl font-semibold text-ink">
            {propertyTitle}
          </h2>
        )}
      </div>

      {/* ── 1. Tipo ──────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader step={1} title="Tipo de inmueble" />
        <div>
          <Label>Tipo</Label>
          <select
            value={form.propertyType}
            onChange={(e) => set("propertyType", e.target.value)}
            className={selectCls}
          >
            <option value="flat">Piso</option>
            <option value="house">Casa</option>
            <option value="penthouse">Ático</option>
            <option value="studio">Estudio / Loft</option>
            <option value="duplex">Dúplex</option>
            <option value="semi-detached">Adosado / Pareado</option>
            <option value="chalet">Chalet independiente</option>
            <option value="villa">Villa</option>
            <option value="land">Solar / Terreno</option>
            <option value="office">Oficina</option>
            <option value="local">Local comercial</option>
            <option value="storage">Trastero</option>
            <option value="garage">Garaje</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip label="Ático" checked={form.isPenthouse} onChange={(v) => set("isPenthouse", v)} />
          <Chip label="Estudio" checked={form.isStudio} onChange={(v) => set("isStudio", v)} />
          <Chip label="Dúplex" checked={form.isDuplex} onChange={(v) => set("isDuplex", v)} />
        </div>
      </section>

      {/* ── 2. Localización ──────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader step={2} title="Localización" />

        {/* Código de referencia */}
        <div>
          <Label>Código de referencia</Label>
          <div className="flex gap-2">
            <input
              type="text"
              value={form.referenceCode}
              readOnly
              placeholder="Se generará automáticamente"
              className={cn(inputCls, "bg-ink/3 cursor-not-allowed")}
            />
            {!form.referenceCode && (
              <button
                type="button"
                onClick={() => set("referenceCode", generateReferenceCode())}
                className="flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/8 px-3 py-2 text-xs font-medium text-gold transition hover:bg-gold/15"
              >
                <RefreshCw size={12} />
                Generar
              </button>
            )}
          </div>
          {form.referenceCode && (
            <p className="mt-1 text-[11px] text-ink/40 font-mono">
              Código inmutable: {form.referenceCode}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label>Calle</Label>
            <input
              type="text"
              value={form.addressStreet}
              onChange={(e) => set("addressStreet", e.target.value)}
              placeholder="Calle Mayor"
              className={inputCls}
            />
          </div>
          <div>
            <Label>Número</Label>
            <input
              type="text"
              value={form.addressNumber}
              onChange={(e) => set("addressNumber", e.target.value)}
              placeholder="12"
              className={inputCls}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label>Código postal</Label>
            <input
              type="text"
              value={form.addressPostalCode}
              onChange={(e) => set("addressPostalCode", e.target.value)}
              placeholder="28001"
              className={inputCls}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Ciudad / Municipio</Label>
            <input
              type="text"
              value={form.addressCity}
              onChange={(e) => set("addressCity", e.target.value)}
              placeholder="Madrid"
              className={inputCls}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Planta</Label>
            <input
              type="text"
              value={form.floor}
              onChange={(e) => set("floor", e.target.value)}
              placeholder="2ª"
              className={inputCls}
            />
          </div>
          <div>
            <Label>Bloque / Portal</Label>
            <input
              type="text"
              value={form.addressBlock}
              onChange={(e) => set("addressBlock", e.target.value)}
              placeholder="A"
              className={inputCls}
            />
          </div>
          <div>
            <Label>Puerta</Label>
            <input
              type="text"
              value={form.addressDoor}
              onChange={(e) => set("addressDoor", e.target.value)}
              placeholder="3ª"
              className={inputCls}
            />
          </div>
        </div>
        <RadioGroup
          label="Visibilidad de la dirección"
          value={form.addressVisibility}
          onChange={(v) => set("addressVisibility", v)}
          options={[
            { value: "exact", label: "Dirección exacta" },
            { value: "street", label: "Solo calle" },
            { value: "hidden", label: "Ocultar dirección" },
          ]}
        />

        {/* Mapa */}
        <GeocodingMapSection
          street={form.addressStreet}
          city={form.addressCity}
          latitude={form.latitude}
          longitude={form.longitude}
          onCoordinatesChange={(lat, lng) => {
            set("latitude", lat);
            set("longitude", lng);
          }}
        />
      </section>

      {/* ── 3. Características ───────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader step={3} title="Características" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <Label>Superficie útil (m²)</Label>
            <input
              type="number"
              min={0}
              value={form.squareMeters || ""}
              onChange={(e) => set("squareMeters", Number(e.target.value))}
              placeholder="80"
              className={inputCls}
            />
          </div>
          <div>
            <Label>Superficie construida (m²)</Label>
            <input
              type="number"
              min={0}
              value={form.builtSquareMeters || ""}
              onChange={(e) => set("builtSquareMeters", Number(e.target.value))}
              placeholder="95"
              className={inputCls}
            />
          </div>
          <Stepper label="Habitaciones" value={form.bedrooms} onChange={(v) => set("bedrooms", v)} />
          <Stepper label="Baños" value={form.bathrooms} onChange={(v) => set("bathrooms", v)} />
        </div>
        <RadioGroup
          label="Estado del inmueble"
          value={form.condition}
          onChange={(v) => set("condition", v)}
          options={[
            { value: "good", label: "Buen estado" },
            { value: "to-reform", label: "Para reformar" },
            { value: "needs-reform", label: "Necesita reforma" },
            { value: "new", label: "Obra nueva" },
          ]}
        />
      </section>

      {/* ── 4. Precio ────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader step={4} title="Precio y condiciones" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Precio (€)</Label>
            <input
              type="number"
              min={0}
              value={form.price || ""}
              onChange={(e) => set("price", Number(e.target.value))}
              placeholder="250000"
              className={inputCls}
            />
          </div>
          <div>
            <Label>Precio total con gastos (€/mes)</Label>
            <input
              type="number"
              min={0}
              value={form.totalRentalPrice || ""}
              onChange={(e) => set("totalRentalPrice", Number(e.target.value))}
              placeholder="1200"
              className={inputCls}
            />
          </div>
        </div>
        <RadioGroup
          label="Tipo de alquiler"
          value={form.rentalType}
          onChange={(v) => set("rentalType", v)}
          options={[
            { value: "residential", label: "Residencial" },
            { value: "temporary", label: "Temporal" },
          ]}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label>Máximo de inquilinos</Label>
            <input
              type="number"
              min={0}
              value={form.maxTenants || ""}
              onChange={(e) => set("maxTenants", Number(e.target.value))}
              placeholder="2"
              className={inputCls}
            />
          </div>
          <div>
            <Label>Mascotas permitidas</Label>
            <div className="flex gap-1.5 mt-1">
              <Chip label="Sí" checked={form.petsAllowed} onChange={(v) => set("petsAllowed", v)} />
              <Chip label="No" checked={!form.petsAllowed} onChange={(v) => set("petsAllowed", !v)} />
            </div>
          </div>
          <div>
            <Label>Apto para niños</Label>
            <div className="flex gap-1.5 mt-1">
              <Chip label="Sí" checked={form.childrenRecommended} onChange={(v) => set("childrenRecommended", v)} />
              <Chip label="No" checked={!form.childrenRecommended} onChange={(v) => set("childrenRecommended", !v)} />
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. Equipamiento ──────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader step={5} title="Equipamiento y extras" />
        <RadioGroup
          label="Equipamiento"
          value={form.equipmentType}
          onChange={(v) => set("equipmentType", v)}
          options={[
            { value: "furnished", label: "Cocina equipada + amueblado" },
            { value: "kitchen-only", label: "Cocina equipada (sin muebles)" },
            { value: "empty", label: "Vacía" },
            { value: "unknown", label: "No lo sé" },
          ]}
        />
        <RadioGroup
          label="Orientación de las ventanas"
          value={form.windowsLocation}
          onChange={(v) => set("windowsLocation", v)}
          options={[
            { value: "exterior", label: "Exterior" },
            { value: "interior", label: "Interior" },
          ]}
        />
        <div>
          <Label>Ascensor</Label>
          <div className="flex gap-1.5">
            <Chip label="Sí" checked={form.hasElevator} onChange={(v) => set("hasElevator", v)} />
            <Chip label="No" checked={!form.hasElevator} onChange={(v) => set("hasElevator", !v)} />
          </div>
        </div>
        <div>
          <Label>Orientación cardinal</Label>
          <div className="flex flex-wrap gap-1.5">
            <Chip label="Norte" checked={form.orientationNorth} onChange={(v) => set("orientationNorth", v)} />
            <Chip label="Sur" checked={form.orientationSouth} onChange={(v) => set("orientationSouth", v)} />
            <Chip label="Este" checked={form.orientationEast} onChange={(v) => set("orientationEast", v)} />
            <Chip label="Oeste" checked={form.orientationWest} onChange={(v) => set("orientationWest", v)} />
          </div>
        </div>
        <div>
          <Label>Otras características</Label>
          <div className="flex flex-wrap gap-1.5">
            <Chip label="Terraza" checked={form.hasTerrace} onChange={(v) => set("hasTerrace", v)} />
            <Chip label="Balcón" checked={form.hasBalcony} onChange={(v) => set("hasBalcony", v)} />
            <Chip label="Garaje" checked={form.hasParking} onChange={(v) => set("hasParking", v)} />
            <Chip label="Trastero" checked={form.hasStorage} onChange={(v) => set("hasStorage", v)} />
            <Chip label="Piscina" checked={form.hasPool} onChange={(v) => set("hasPool", v)} />
            <Chip label="Jardín" checked={form.hasGarden} onChange={(v) => set("hasGarden", v)} />
            <Chip label="Armarios empotrados" checked={form.hasWardrobes} onChange={(v) => set("hasWardrobes", v)} />
            <Chip label="Aire acondicionado" checked={form.hasAC} onChange={(v) => set("hasAC", v)} />
          </div>
        </div>
      </section>

      {/* ── 6. Energía ───────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader step={6} title="Eficiencia energética" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <Label>Calificación energética</Label>
            <select
              value={form.energyClass}
              onChange={(e) => set("energyClass", e.target.value)}
              className={selectCls}
            >
              <option value="">Sin calificación</option>
              {["A", "B", "C", "D", "E", "F", "G"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="pending">En trámite</option>
            </select>
          </div>
          <div>
            <Label>Consumo (kWh/m² año)</Label>
            <input
              type="number"
              min={0}
              value={form.energyPerformance || ""}
              onChange={(e) => set("energyPerformance", Number(e.target.value))}
              placeholder="120"
              className={inputCls}
            />
          </div>
          <div>
            <Label>Calificación emisiones</Label>
            <select
              value={form.emissionRating}
              onChange={(e) => set("emissionRating", e.target.value)}
              className={selectCls}
            >
              <option value="">Sin calificación</option>
              {["A", "B", "C", "D", "E", "F", "G"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="pending">En trámite</option>
            </select>
          </div>
          <div>
            <Label>Emisiones (kgCO₂/m² año)</Label>
            <input
              type="number"
              min={0}
              value={form.emissionValue || ""}
              onChange={(e) => set("emissionValue", Number(e.target.value))}
              placeholder="35"
              className={inputCls}
            />
          </div>
        </div>
      </section>

      {/* ── 7. Descripción ───────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader step={7} title="Descripción del anuncio" />
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label>Descripción principal</Label>
            <button
              type="button"
              onClick={() => setShowDescPreview((v) => !v)}
              className="text-[11px] text-gold hover:underline"
            >
              {showDescPreview ? "Ocultar vista previa" : "Ver con footer"}
            </button>
          </div>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={6}
            placeholder="Describe la propiedad: distribución, calidades, vistas, entorno del barrio..."
            className={cn(inputCls, "resize-y")}
          />
        </div>

        {showDescPreview && (
          <div className="rounded-xl border border-ink/10 bg-white/60 p-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink/40">
              Vista previa completa del texto
            </p>
            <pre className="whitespace-pre-wrap text-sm text-ink/80 font-sans leading-relaxed">
              {(form.description || "").trimEnd()}
              {DESCRIPTION_FOOTER}
            </pre>
          </div>
        )}

        <div className="rounded-xl border border-gold/20 bg-gold/5 px-4 py-3 text-xs text-ink/60">
          <strong className="text-ink/80">Footer automático</strong> — al final siempre se agrega:
          <pre className="mt-1 whitespace-pre-wrap text-xs text-ink/50 font-sans">{DESCRIPTION_FOOTER.trim()}</pre>
        </div>
      </section>

      {/* ── 8. Fotos ─────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader step={8} title="Fotos" />
        <MediaUploadZone
          label="Imágenes de la propiedad"
          items={form.photos}
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic"
          icon={ImageIcon}
          onChange={(urls) => set("photos", urls)}
        />
      </section>

      {/* ── 9. Videos y planos ───────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader step={9} title="Videos y planos" />
        <MediaUploadZone
          label="Videos"
          items={form.videos}
          accept="video/mp4,video/quicktime,video/webm,video/avi,video/x-matroska"
          icon={Video}
          onChange={(urls) => set("videos", urls)}
        />
        <MediaUploadZone
          label="Planos"
          items={form.plans}
          accept="image/jpeg,image/png,image/webp,application/pdf"
          icon={ImageIcon}
          onChange={(urls) => set("plans", urls)}
        />
      </section>

      {/* ── 10. Contacto e info interna ──────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader step={10} title="Contacto e info interna" />
        <div>
          <Label>ID de contacto en Idealista</Label>
          <input
            type="text"
            value={form.contactId}
            onChange={(e) => set("contactId", e.target.value)}
            placeholder="Dejar vacío si no se conoce aún"
            className={inputCls}
          />
        </div>
        <div>
          <Label>Notas internas (no se publican)</Label>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            placeholder="Observaciones para el equipo..."
            className={cn(inputCls, "resize-none")}
          />
        </div>
      </section>

      {/* ── Guardar ──────────────────────────────────────────────────────── */}
      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-sm font-semibold text-cream-50 transition hover:bg-ink/85 disabled:opacity-50"
        >
          <Save size={15} />
          {saving ? "Guardando..." : "Guardar borrador"}
        </button>
      </div>
    </form>
  );
}
