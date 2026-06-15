"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ExternalLink,
  FileDown,
  FileImage,
  Image as ImageIcon,
  Info,
  Link2,
  Loader2,
  MapIcon,
  Plus,
  Save,
  Send,
  Trash2,
  User,
  Video,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  updateProperty,
  addPropertyVideo,
  uploadPropertyPlan,
  deletePropertyMedia,
  type MediaItem,
} from "@/app/(admin)/admin/propiedades/actions";
import { PropertyPhotosModal } from "@/components/admin/property-photos-modal";
import {
  type SmartLinkRow,
  SmartLinksPanel,
} from "@/components/admin/smart-links-panel";
import { useT } from "@/lib/i18n/provider";
import { shareSlug } from "@/lib/share-slug";
import { cn } from "@/lib/utils";

type Photo = {
  url: string;
  alt: string | null;
  position: number;
  is_cover: boolean;
};

export type PropertyForEdit = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  operation: "rent" | "sale";
  stay: "short" | "long" | null;
  status: "available" | "reserved" | "sold" | "archived";
  price: number;
  bedrooms: number;
  bathrooms: number;
  square_meters: number | null;
  zone: string;
  address: string | null;
  features: string[];
  features_manual: string[];
  latitude: number | null;
  longitude: number | null;
  available_from: string | null;
  bc_reference: string | null;
  property_reference: string;
  source: "manual" | "scrape" | "api";
  source_url: string | null;
  archived_at: string | null;
  cover_photo_url: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  internal_notes: string | null;
  agency: { id: string; name: string; slug: string } | null;
  photos: Photo[];
};

type SaveState =
  | { kind: "idle" }
  | { kind: "saved"; at: number }
  | { kind: "error"; msg: string };

export function PropertyEditView({
  property,
  shares,
  videos: initialVideos = [],
  plans: initialPlans = [],
}: {
  property: PropertyForEdit;
  shares: SmartLinkRow[];
  videos?: MediaItem[];
  plans?: MediaItem[];
}) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [photosOpen, setPhotosOpen] = useState(false);

  // Videos state
  const [videos, setVideos] = useState<MediaItem[]>(initialVideos);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [addingVideo, setAddingVideo] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0); // 0-100
  const [uploadEta, setUploadEta] = useState<string | null>(null); // "1m 23s"
  const uploadStartRef = useRef<number>(0);
  const videoFileInputRef = useRef<HTMLInputElement>(null);

  // Planos state
  const [plans, setPlans] = useState<MediaItem[]>(initialPlans);
  const [planError, setPlanError] = useState<string | null>(null);
  const [uploadingPlan, setUploadingPlan] = useState(false);
  const planInputRef = useRef<HTMLInputElement>(null);

  // Estado del form. Inicializamos con los valores actuales.
  const [title, setTitle] = useState(property.title);
  const [description, setDescription] = useState(property.description ?? "");
  const [price, setPrice] = useState(property.price);
  const [bedrooms, setBedrooms] = useState(property.bedrooms);
  const [bathrooms, setBathrooms] = useState(property.bathrooms);
  const [squareMeters, setSquareMeters] = useState<number | "">(
    property.square_meters ?? "",
  );
  const [zone, setZone] = useState(property.zone);
  const [address, setAddress] = useState(property.address ?? "");
  const [operation, setOperation] = useState(property.operation);
  const [stay, setStay] = useState<"short" | "long" | "">(property.stay ?? "");
  const [availableFrom, setAvailableFrom] = useState(property.available_from ?? "");
  const [status, setStatus] = useState(property.status);
  const [ownerName, setOwnerName] = useState(property.owner_name ?? "");
  const [ownerPhone, setOwnerPhone] = useState(property.owner_phone ?? "");
  const [ownerEmail, setOwnerEmail] = useState(property.owner_email ?? "");
  const [internalNotes, setInternalNotes] = useState(
    property.internal_notes ?? "",
  );
  const [featuresManual, setFeaturesManual] = useState<string[]>(
    property.features_manual ?? [],
  );
  const [newFeature, setNewFeature] = useState("");
  const [copied, setCopied] = useState(false);

  const addManualFeature = () => {
    const f = newFeature.trim();
    if (!f) return;
    // Evita duplicados con las auto-detectadas y entre las manuales.
    const already = new Set(
      [...property.features, ...featuresManual].map((x) =>
        x.toLowerCase(),
      ),
    );
    if (already.has(f.toLowerCase())) {
      setNewFeature("");
      return;
    }
    setFeaturesManual((prev) => [...prev, f]);
    setNewFeature("");
  };

  const removeManualFeature = (f: string) => {
    setFeaturesManual((prev) => prev.filter((x) => x !== f));
  };

  // ─── Video handlers ────────────────────────────────────────────────────
  async function handleAddVideo() {
    if (!videoUrl.trim()) return;
    setAddingVideo(true);
    setVideoError(null);
    const res = await addPropertyVideo(property.slug, videoUrl.trim());
    if (res.ok) {
      setVideos((v) => [...v, res.item]);
      setVideoUrl("");
    } else {
      setVideoError(res.error);
    }
    setAddingVideo(false);
  }

  async function handleDeleteVideo(item: MediaItem) {
    if (!confirm("¿Eliminar este video?")) return;
    await deletePropertyMedia(property.slug, item.id, item.storage_path);
    setVideos((v) => v.filter((x) => x.id !== item.id));
  }

  function handleVideoFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoError(null);
    setUploadingVideo(true);
    setUploadProgress(0);
    setUploadEta(null);
    uploadStartRef.current = Date.now();

    const fd = new FormData();
    fd.set("slug", property.slug);
    fd.set("file", file);

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (ev) => {
      if (!ev.lengthComputable) return;
      // Limita al 95% durante el upload (deja espacio para procesamiento del servidor)
      const pct = Math.min(95, Math.round((ev.loaded / ev.total) * 95));
      setUploadProgress(pct);
      const elapsed = (Date.now() - uploadStartRef.current) / 1000;
      if (elapsed > 0.5 && ev.loaded > 0) {
        const rate = ev.loaded / elapsed; // bytes/s
        const remaining = (ev.total - ev.loaded) / rate; // seconds
        if (remaining >= 60) {
          const m = Math.floor(remaining / 60);
          const s = Math.round(remaining % 60);
          setUploadEta(`${m}m ${s}s`);
        } else {
          setUploadEta(`${Math.round(remaining)}s`);
        }
      }
    });
    xhr.addEventListener("load", () => {
      if (videoFileInputRef.current) videoFileInputRef.current.value = "";
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadProgress(100);
        setTimeout(() => {
          setUploadingVideo(false);
          setUploadProgress(0);
          setUploadEta(null);
        }, 300);
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.ok && data.item) {
            setVideos((v) => [...v, data.item]);
          } else {
            setVideoError(data.error || "Error al subir vídeo");
          }
        } catch {
          setVideoError("Respuesta inesperada del servidor");
        }
      } else {
        setUploadingVideo(false);
        setUploadProgress(0);
        setUploadEta(null);
        try {
          const data = JSON.parse(xhr.responseText);
          setVideoError(data.error || `Error ${xhr.status}`);
        } catch {
          setVideoError(`Error ${xhr.status} al subir`);
        }
      }
    });
    xhr.addEventListener("error", () => {
      setUploadingVideo(false);
      setUploadProgress(0);
      setUploadEta(null);
      setVideoError("Error de red al subir el vídeo");
      if (videoFileInputRef.current) videoFileInputRef.current.value = "";
    });
    xhr.open("POST", "/api/admin/properties/upload-video");
    xhr.send(fd);
  }

  // ─── Plan handlers ─────────────────────────────────────────────────────
  async function handlePlanUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setPlanError(null);
    setUploadingPlan(true);
    for (const file of files) {
      const fd = new FormData();
      fd.set("slug", property.slug);
      fd.set("file", file);
      const res = await uploadPropertyPlan(fd);
      if (res.ok) setPlans((p) => [...p, res.item]);
      else { setPlanError(res.error); break; }
    }
    setUploadingPlan(false);
    if (planInputRef.current) planInputRef.current.value = "";
  }

  async function handleDeletePlan(item: MediaItem) {
    if (!confirm("¿Eliminar este plano?")) return;
    await deletePropertyMedia(property.slug, item.id, item.storage_path);
    setPlans((p) => p.filter((x) => x.id !== item.id));
  }

  function getEmbedUrl(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) {
        return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
      }
      if (u.hostname.includes("youtube.com")) {
        const id = u.searchParams.get("v");
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      if (u.hostname.includes("vimeo.com")) {
        const id = u.pathname.split("/").filter(Boolean).pop();
        return id ? `https://player.vimeo.com/video/${id}` : null;
      }
    } catch {}
    return null;
  }

  const isScraped = property.source === "scrape";

  // SmartLink: URL pública del compartir, con la referencia BC al inicio del
  // slug (bc0871-…). En cliente usamos window.origin para que funcione tanto
  // en local (localhost) como en producción.
  const publicSlug = shareSlug(property.slug, property.bc_reference);
  const smartLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/compartir/${publicSlug}`
      : `/compartir/${publicSlug}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(smartLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback rudimentario si no hay permiso de portapapeles.
      window.prompt(t("adminProps.detail.copyLinkFallback"), smartLink);
    }
  };
  const cover =
    property.cover_photo_url ??
    property.photos.find((p) => p.is_cover)?.url ??
    property.photos[0]?.url ??
    null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveState({ kind: "idle" });
    startTransition(async () => {
      const res = await updateProperty({
        slug: property.slug,
        title,
        description: description || null,
        price,
        bedrooms,
        bathrooms,
        squareMeters: squareMeters === "" ? null : Number(squareMeters),
        zone,
        address: address || null,
        operation,
        stay: stay || null,
        availableFrom: availableFrom || null,
        status,
        ownerName: ownerName || null,
        ownerPhone: ownerPhone || null,
        ownerEmail: ownerEmail || null,
        internalNotes: internalNotes || null,
        featuresManual,
      });
      if (res.ok) {
        setSaveState({ kind: "saved", at: Date.now() });
        router.refresh();
      } else {
        setSaveState({ kind: "error", msg: res.error });
      }
    });
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-[1100px] flex-col px-6 pb-24 lg:px-10">
      {/* Cabecera */}
      <div className="flex items-center justify-between pt-7">
        <Link
          href="/admin/propiedades"
          className="inline-flex items-center gap-2 text-[12px] font-medium text-ink/65 transition hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={1.75} />
          <span>{t("adminProps.detail.back")}</span>
        </Link>
        <span
          className={cn(
            "rounded-md border px-2.5 py-1 text-[11px] font-medium",
            isScraped
              ? "border-gold/35 bg-gold/10 text-gold-dark"
              : "border-ink/15 bg-ink/5 text-ink/65",
          )}
        >
          {isScraped
            ? t("adminProps.detail.sourceScrape", {
                agency: property.agency?.name ?? "—",
              })
            : t("adminProps.detail.sourceManual")}
        </span>
      </div>

      <header className="mt-4 flex items-start gap-5">
        <button
          type="button"
          onClick={() => setPhotosOpen(true)}
          className="relative h-24 w-32 shrink-0 overflow-hidden rounded-lg border border-gold/20 bg-cream-50 transition hover:border-gold/55"
          aria-label={t("adminProps.photos.manage")}
        >
          {cover ? (
            <Image
              src={cover}
              alt=""
              fill
              sizes="128px"
              className="object-cover"
            />
          ) : (
            <ImageIcon
              size={20}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-ink/40"
            />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {property.property_reference && (
              <span
                className="rounded-md border border-ink/10 bg-ink/5 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-ink/80"
              >
                {property.property_reference}
              </span>
            )}
            {property.bc_reference && (
              <span
                className="rounded-md border border-gold/30 bg-gold/10 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-gold-dark"
              >
                {property.bc_reference}
              </span>
            )}
          </div>
          <h1 className="mt-1 font-serif text-2xl font-medium leading-tight text-ink md:text-3xl">
            {property.title}
          </h1>
          <p className="mt-1 text-[12px] text-ink/55">
            {property.zone} · {property.bedrooms} hbt · {property.bathrooms} baños
            {property.square_meters ? ` · ${property.square_meters} m²` : ""}
            {property.source_url && (
              <>
                {" · "}
                <a
                  href={property.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gold-dark hover:underline"
                >
                  {t("adminProps.detail.viewOnAgency")}
                </a>
              </>
            )}
          </p>
        </div>
      </header>

      {/* Acciones rápidas: ver como cliente / copiar SmartLink / descargar PDF */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <a
          href={`/compartir/${property.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-gold/30 bg-cream-50 px-4 py-2 text-[12px] font-medium text-ink transition hover:border-gold/55 hover:bg-white"
        >
          <ExternalLink size={13} strokeWidth={1.75} className="text-gold-dark" />
          <span>{t("adminProps.detail.viewAsClient")}</span>
        </a>
        <button
          type="button"
          onClick={handleCopyLink}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-[12px] font-medium transition",
            copied
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-gold/30 bg-cream-50 text-ink hover:border-gold/55 hover:bg-white",
          )}
        >
          {copied ? (
            <Check size={13} strokeWidth={2} />
          ) : (
            <Link2 size={13} strokeWidth={1.75} className="text-gold-dark" />
          )}
          <span>
            {copied
              ? t("adminProps.detail.linkCopied")
              : t("adminProps.detail.copyLink")}
          </span>
        </button>
        <a
          href={`/api/admin/properties/${property.slug}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-gold/30 bg-cream-50 px-4 py-2 text-[12px] font-medium text-ink transition hover:border-gold/55 hover:bg-white"
        >
          <FileDown size={13} strokeWidth={1.75} className="text-gold-dark" />
          <span>{t("adminProps.detail.downloadPdf")}</span>
        </a>
      </div>

      {/* Aviso para propiedades sindicadas */}
      {isScraped && (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-gold/30 bg-gold/10 p-3.5 text-[12px] text-ink/80">
          <AlertTriangle
            size={16}
            strokeWidth={1.75}
            className="mt-0.5 shrink-0 text-gold-dark"
          />
          <span>{t("adminProps.detail.scrapedWarning")}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="mt-6 flex flex-col gap-6">
        {/* Datos básicos */}
        <Section
          icon={<Info size={15} strokeWidth={1.75} />}
          title={t("adminProps.detail.basicData")}
        >
          <Field label={t("adminProps.detail.title")}>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className={inputClass}
            />
          </Field>
          <Field label={t("adminProps.detail.description")}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className={cn(inputClass, "resize-y")}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field
              label={
                property.operation === "rent"
                  ? t("adminProps.detail.priceRent")
                  : t("adminProps.detail.priceSale")
              }
            >
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                min={0}
                required
                className={inputClass}
              />
            </Field>
            <Field label={t("adminProps.detail.bedrooms")}>
              <input
                type="number"
                value={bedrooms}
                onChange={(e) => setBedrooms(Number(e.target.value))}
                min={0}
                className={inputClass}
              />
            </Field>
            <Field label={t("adminProps.detail.bathrooms")}>
              <input
                type="number"
                value={bathrooms}
                onChange={(e) => setBathrooms(Number(e.target.value))}
                min={0}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label={t("adminProps.detail.squareMeters")}>
              <input
                type="number"
                value={squareMeters}
                onChange={(e) =>
                  setSquareMeters(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                min={0}
                className={inputClass}
              />
            </Field>
            <Field label={t("adminProps.detail.zone")}>
              <input
                type="text"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                required
                className={inputClass}
              />
            </Field>
            <Field label={t("adminProps.detail.status")}>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(
                    e.target.value as PropertyForEdit["status"],
                  )
                }
                className={inputClass}
              >
                <option value="available">
                  {t("adminProps.status.available")}
                </option>
                <option value="reserved">
                  {t("adminProps.status.reserved")}
                </option>
                <option value="sold">{t("adminProps.status.sold")}</option>
                <option value="archived">
                  {t("adminProps.status.archived")}
                </option>
              </select>
            </Field>
          </div>
          <Field label={t("adminProps.detail.address")}>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputClass}
              placeholder={t("adminProps.detail.addressPlaceholder")}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Operación">
              <select
                value={operation}
                onChange={(e) =>
                  setOperation(e.target.value as "rent" | "sale")
                }
                className={inputClass}
              >
                <option value="rent">Alquiler</option>
                <option value="sale">Venta</option>
              </select>
            </Field>
            <Field label="Modalidad">
              <select
                value={stay}
                onChange={(e) =>
                  setStay(e.target.value as "short" | "long" | "")
                }
                className={inputClass}
                disabled={operation === "sale"}
              >
                <option value="">— No aplica —</option>
                <option value="long">Larga estancia</option>
                <option value="short">Corta estancia</option>
              </select>
            </Field>
            <Field label="Disponible desde">
              <input
                type="date"
                value={availableFrom}
                onChange={(e) => setAvailableFrom(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          {/* Mapa con la ubicación REAL geocodificada (uso interno —
              dirección exacta visible). El admin lo usa para verificar
              que el geocoding acertó. Si la posición es incorrecta, basta
              con corregir la dirección y guardar: en el siguiente acceso
              al SmartLink se recalcula. */}
          <AdminPropertyMap
            lat={property.latitude}
            lng={property.longitude}
            address={address || null}
            zone={zone}
          />
        </Section>

        {/* Info del dueño — NUNCA se sobrescribe por el sync */}
        <Section
          icon={<User size={15} strokeWidth={1.75} />}
          title={t("adminProps.detail.ownerSection")}
          subtitle={t("adminProps.detail.ownerSubtitle")}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label={t("adminProps.detail.ownerName")}>
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className={inputClass}
                placeholder={t("adminProps.detail.ownerNamePh")}
              />
            </Field>
            <Field label={t("adminProps.detail.ownerPhone")}>
              <input
                type="tel"
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value)}
                className={inputClass}
                placeholder="+34 ..."
              />
            </Field>
            <Field label={t("adminProps.detail.ownerEmail")}>
              <input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className={inputClass}
                placeholder="email@..."
              />
            </Field>
          </div>
          <Field label={t("adminProps.detail.internalNotes")}>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={4}
              className={cn(inputClass, "resize-y")}
              placeholder={t("adminProps.detail.internalNotesPh")}
            />
          </Field>
        </Section>

        {/* Características: auto-detectadas (de la descripción) + manuales */}
        <Section
          icon={<Info size={15} strokeWidth={1.75} />}
          title="Características"
          subtitle="Las auto-detectadas vienen de la descripción del piso (se actualizan en cada sync). Añade manuales si conoces alguna que la descripción no menciona."
        >
          {property.features.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ink/55">
                Auto-detectadas
              </p>
              <div className="flex flex-wrap gap-1.5">
                {property.features.map((f) => (
                  <span
                    key={`auto-${f}`}
                    className="inline-flex items-center gap-1 rounded-md border border-ink/15 bg-ink/5 px-2.5 py-1 text-[12px] text-ink/70"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ink/55">
              Manuales
            </p>
            {featuresManual.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {featuresManual.map((f) => (
                  <span
                    key={`man-${f}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-2.5 py-1 text-[12px] text-ink"
                  >
                    {f}
                    <button
                      type="button"
                      onClick={() => removeManualFeature(f)}
                      className="text-ink/55 hover:text-rose-700"
                      aria-label={`Quitar ${f}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newFeature}
                onChange={(e) => setNewFeature(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addManualFeature();
                  }
                }}
                placeholder="Ej. Vistas al parque, Suelo de tarima, Bodega…"
                className={cn(inputClass, "flex-1")}
              />
              <button
                type="button"
                onClick={addManualFeature}
                disabled={!newFeature.trim()}
                className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-[12px] font-medium text-ink/75 transition hover:border-gold/55 hover:text-ink disabled:opacity-50"
              >
                Añadir
              </button>
            </div>
          </div>
        </Section>

        {/* SmartLinks: links únicos con tracking por envío */}
        <Section
          icon={<Send size={15} strokeWidth={1.75} />}
          title={t("adminProps.smartLinks.title")}
        >
          <SmartLinksPanel slug={property.slug} initialLinks={shares} />
        </Section>

        {/* Fotos */}
        <Section
          icon={<ImageIcon size={15} strokeWidth={1.75} />}
          title={t("adminProps.detail.photosSection")}
        >
          <button
            type="button"
            onClick={() => setPhotosOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-ink/15 bg-white px-4 py-2 text-[12px] font-medium text-ink/75 transition hover:border-gold/55 hover:text-ink"
          >
            <ImageIcon size={13} strokeWidth={1.75} className="text-gold" />
            <span>
              {t("adminProps.photos.action", {
                count: property.photos.length,
              })}
            </span>
          </button>
        </Section>

        {/* Videos */}
        <Section
          icon={<Video size={15} strokeWidth={1.75} />}
          title="Videos"
        >
          {/* Input oculto para subir archivo de video */}
          <input
            type="file"
            ref={videoFileInputRef}
            accept="video/*"
            onChange={handleVideoFileUpload}
            className="hidden"
          />
          <div className="flex gap-2">
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAddVideo();
                }
              }}
              placeholder="https://www.youtube.com/watch?v=… o Vimeo"
              className={cn(inputClass, "flex-1")}
            />
            <button
              type="button"
              onClick={() => void handleAddVideo()}
              disabled={addingVideo || !videoUrl.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-4 py-2 text-[12px] font-medium text-ink/75 transition hover:border-gold/55 hover:text-ink disabled:opacity-50"
            >
              {addingVideo ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Plus size={13} strokeWidth={1.75} />
              )}
              Añadir
            </button>
          </div>
          {uploadingVideo ? (
            <div className="mt-2 rounded-lg border border-gold/30 bg-gold/5 p-3">
              <div className="mb-1.5 flex items-center justify-between text-[12px] text-ink/70">
                <span className="font-medium">Subiendo vídeo…</span>
                <span className="tabular-nums">
                  {uploadProgress}%{uploadEta ? ` · ${uploadEta} restante` : ""}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-ink/10">
                <div
                  className="h-full rounded-full bg-gold transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => videoFileInputRef.current?.click()}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-4 py-2 text-[12px] font-medium text-ink/75 transition hover:border-gold/55 hover:text-ink"
            >
              <Plus size={13} strokeWidth={1.75} />
              Subir video (.mp4)
            </button>
          )}
          {videoError && (
            <p className="mt-1 text-[12px] text-rose-700">{videoError}</p>
          )}
          {videos.length > 0 && (
            <div className="mt-3 flex flex-col gap-3">
              {videos.map((item) => {
                const embed = getEmbedUrl(item.url);
                const isDirectVideo = !embed && item.storage_path && !item.storage_path.startsWith("http");
                return (
                  <div
                    key={item.id}
                    className="relative overflow-hidden rounded-lg border border-ink/10 bg-white/85"
                  >
                    {embed ? (
                      <iframe
                        src={embed}
                        className="aspect-video w-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    ) : isDirectVideo ? (
                      <video
                        src={item.url}
                        controls
                        className="aspect-video w-full"
                        preload="metadata"
                      />
                    ) : (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 text-sm text-ink/75 hover:text-gold"
                      >
                        <Video size={14} strokeWidth={1.75} />
                        {item.url}
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteVideo(item)}
                      className="absolute right-2 top-2 rounded-full bg-ink/70 p-1 text-white transition hover:bg-rose-700"
                      title="Eliminar video"
                    >
                      <Trash2 size={13} strokeWidth={1.75} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {videos.length === 0 && (
            <p className="mt-2 text-[12px] text-ink/45">
              Sin videos aún. Añade un enlace de YouTube/Vimeo o sube un archivo MP4.
            </p>
          )}
        </Section>

        {/* Planos */}
        <Section
          icon={<FileImage size={15} strokeWidth={1.75} />}
          title="Planos"
        >
          <input
            type="file"
            ref={planInputRef}
            multiple
            accept="image/*"
            onChange={handlePlanUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => planInputRef.current?.click()}
            disabled={uploadingPlan}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-4 py-2 text-[12px] font-medium text-ink/75 transition hover:border-gold/55 hover:text-ink disabled:opacity-50"
          >
            {uploadingPlan ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Plus size={13} strokeWidth={1.75} />
            )}
            Subir plano
          </button>
          {planError && (
            <p className="mt-1 text-[12px] text-rose-700">{planError}</p>
          )}
          {plans.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
              {plans.map((item) => (
                <div
                  key={item.id}
                  className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-ink/10 bg-ink/5"
                >
                  <Image
                    src={item.url}
                    alt={item.file_name}
                    fill
                    sizes="(max-width: 768px) 50vw, 33vw"
                    className="object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => handleDeletePlan(item)}
                    className="absolute right-1.5 top-1.5 rounded-full bg-ink/70 p-1 text-white opacity-0 transition hover:bg-rose-700 group-hover:opacity-100"
                    title="Eliminar plano"
                  >
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                  <div className="absolute inset-x-0 bottom-0 truncate bg-ink/60 px-2 py-1 text-[11px] text-white opacity-0 transition group-hover:opacity-100">
                    {item.file_name}
                  </div>
                </div>
              ))}
            </div>
          )}
          {plans.length === 0 && (
            <p className="mt-2 text-[12px] text-ink/45">
              Sin planos aún. Sube imágenes de la distribución.
            </p>
          )}
        </Section>

        {/* Barra inferior sticky con guardar */}
        <div className="sticky bottom-4 mt-2 flex items-center justify-between gap-3 rounded-xl border border-gold/25 bg-cream-50/95 px-4 py-3 shadow-[0_15px_40px_-20px_rgba(40,28,10,0.35)] backdrop-blur">
          <div className="text-[12px] text-ink/65">
            {saveState.kind === "saved" && (
              <span className="text-emerald-700">
                ✓ {t("adminProps.detail.saved")}
              </span>
            )}
            {saveState.kind === "error" && (
              <span className="text-rose-700">
                {t("adminProps.detail.errorSaving", { error: saveState.msg })}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-[12px] font-medium text-cream-50 transition hover:bg-ink-soft disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} strokeWidth={1.75} className="text-gold" />
            )}
            <span>{t("adminProps.detail.save")}</span>
          </button>
        </div>
      </form>

      <PropertyPhotosModal
        open={photosOpen}
        onClose={() => setPhotosOpen(false)}
        slug={property.slug}
        title={property.title}
        initialPhotos={property.photos.map((p) => ({
          url: p.url,
          isCover: p.is_cover,
        }))}
      />
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-ink/10 bg-white/85 px-3 py-2 text-sm text-ink focus:border-gold/55 focus:outline-none";

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/80 p-5 shadow-[0_10px_30px_-20px_rgba(40,28,10,0.25)] md:p-6">
      <header className="flex items-start gap-2.5">
        <span className="mt-0.5 text-gold-dark">{icon}</span>
        <div>
          <h2 className="font-serif text-lg font-medium text-ink">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-ink/55">{subtitle}</p>
          )}
        </div>
      </header>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[12px] font-medium text-ink/80">
      <span>{label}</span>
      {children}
    </label>
  );
}

// Mini-mapa para el admin: muestra la ubicación REAL del piso con el pin
// exacto (no aproximada como en el SmartLink). Si no hay coordenadas
// geocodificadas todavía, informa al admin.
function AdminPropertyMap({
  lat,
  lng,
  address,
  zone,
}: {
  lat: number | null;
  lng: number | null;
  address: string | null;
  zone: string;
}) {
  if (lat == null || lng == null) {
    return (
      <div className="rounded-lg border border-dashed border-ink/15 bg-ink/[0.03] p-4 text-[12px] text-ink/55">
        <p className="font-medium text-ink/70">Sin coordenadas geocodificadas</p>
        <p className="mt-1">
          Las coordenadas se calculan automáticamente la primera vez que
          alguien abre el SmartLink público de la propiedad. Si acabas de
          editar la dirección, las coordenadas anteriores se han borrado y
          se recalcularán en el próximo acceso al SmartLink.
        </p>
      </div>
    );
  }
  // Centro exacto + marker preciso (el admin sí ve la dirección). Bbox
  // estrecho (~150m radio) para ver la calle concreta.
  const delta = 0.0025;
  const bbox = [lng - delta, lat - delta * 0.6, lng + delta, lat + delta * 0.6].join(
    ",",
  );
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  const externalLink = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
  return (
    <div className="overflow-hidden rounded-lg border border-ink/15 bg-white">
      <div className="flex items-center justify-between px-3 py-2 text-[11px] text-ink/55">
        <span>
          Ubicación geocodificada · {address ? address : zone}
        </span>
        <a
          href={externalLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gold-dark hover:underline"
        >
          Abrir en OSM ↗
        </a>
      </div>
      <div className="aspect-[16/9] w-full md:aspect-[16/8]">
        <iframe
          title={`Mapa de ${address ?? zone}`}
          src={src}
          className="h-full w-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  );
}
