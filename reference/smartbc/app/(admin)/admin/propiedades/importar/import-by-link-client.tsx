"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmByLink,
  previewByLink,
} from "@/app/(admin)/admin/propiedades/importar/actions";
import type { ImportPreview } from "@/lib/sync/import-by-link/types";
import { cn } from "@/lib/utils";

type AgencyOption = { slug: string; name: string };

type FormState = {
  title: string;
  description: string;
  operation: "rent" | "sale";
  stay: "long" | "short" | "";
  price: string;
  bedrooms: string;
  bathrooms: string;
  squareMeters: string;
  zone: string;
  address: string;
  features: string;
  externalReference: string;
  agencySlug: string;
  selectedPhotos: Set<number>;
};

function previewToFormState(
  preview: ImportPreview,
  defaultAgencySlug: string,
): FormState {
  return {
    title: preview.title ?? "",
    description: preview.description ?? "",
    operation: preview.operation === "rent" ? "rent" : "sale",
    stay: preview.stay ?? "",
    price: preview.price ? String(preview.price) : "",
    bedrooms: preview.bedrooms ? String(preview.bedrooms) : "",
    bathrooms: preview.bathrooms ? String(preview.bathrooms) : "",
    squareMeters: preview.squareMeters ? String(preview.squareMeters) : "",
    zone: preview.zone ?? "",
    address: preview.address ?? "",
    features: preview.features.join(", "),
    externalReference: preview.externalReference,
    agencySlug: defaultAgencySlug,
    selectedPhotos: new Set(preview.photos.map((_, i) => i)),
  };
}

export function ImportByLinkClient({
  agencies,
}: {
  agencies: AgencyOption[];
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const [confirming, startConfirm] = useTransition();

  function handlePreview() {
    setError(null);
    setSuccess(null);
    startPreview(async () => {
      const result = await previewByLink(url);
      if (!result.ok) {
        setError(result.error);
        setPreview(null);
        setForm(null);
        return;
      }
      setPreview(result.preview);
      // Los pisos importados por link van TODOS a la agencia genérica
      // "Portales externos" (slug `portales-externos`). El usuario puede
      // recategorizar después desde la ficha si tiene un acuerdo con la
      // agencia o portal concretos.
      setForm(previewToFormState(result.preview, "portales-externos"));
    });
  }

  function handleConfirm() {
    if (!preview || !form) return;
    setError(null);
    setSuccess(null);

    // Validación cliente — defensa en profundidad; el server vuelve a validar.
    const price = parseInt(form.price, 10);
    const bedrooms = parseInt(form.bedrooms, 10);
    const bathrooms = parseInt(form.bathrooms, 10);
    const squareMeters = form.squareMeters
      ? parseInt(form.squareMeters, 10)
      : null;
    if (!form.title.trim()) return setError("El título es obligatorio");
    if (!form.zone.trim()) return setError("La zona es obligatoria");
    if (!form.agencySlug) return setError("Selecciona una agencia");
    if (!form.externalReference.trim())
      return setError("La referencia externa es obligatoria");
    if (!isFinite(price) || price <= 0)
      return setError("Precio inválido");
    if (!isFinite(bedrooms) || bedrooms < 0)
      return setError("Habitaciones inválido");
    if (!isFinite(bathrooms) || bathrooms < 0)
      return setError("Baños inválido");

    const features = form.features
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    startConfirm(async () => {
      try {
        const result = await confirmByLink({
          preview,
          agencySlug: form.agencySlug,
          overrides: {
            title: form.title,
            description: form.description || null,
            operation: form.operation,
            stay: form.stay === "" ? null : form.stay,
            price,
            bedrooms,
            bathrooms,
            squareMeters,
            zone: form.zone,
            address: form.address || null,
            features,
            externalReference: form.externalReference,
            photoIndexes: Array.from(form.selectedPhotos),
          },
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSuccess(
          `Propiedad creada con ${result.photosProcessed} fotos. Slug: ${result.slug}`,
        );
        // Vuelve al listado tras 1.5s.
        setTimeout(() => router.push("/admin/propiedades"), 1500);
      } catch {
        // Si la acción falla o tarda demasiado (muchas fotos), mostramos un
        // aviso en vez de dejar que reviente la página. La propiedad puede
        // haberse creado igualmente en el servidor: revísala en el listado.
        setError(
          "La importación tardó demasiado o falló. Si la ficha tiene muchas fotos, " +
            "puede haberse creado igualmente — revisa el catálogo y, si no está, reintenta.",
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Paso 1: URL */}
      <div className="space-y-2">
        <label
          htmlFor="import-url"
          className="text-sm font-medium text-ink/80"
        >
          URL de la propiedad
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="import-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.idealista.com/inmueble/..."
            className="flex-1 rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-sm placeholder:text-ink/35 focus:border-gold/55 focus:outline-none"
            disabled={previewing || confirming}
          />
          <button
            type="button"
            onClick={handlePreview}
            disabled={!url.trim() || previewing || confirming}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-cream-50 transition disabled:opacity-50"
          >
            {previewing ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <ArrowRight size={15} />
            )}
            Extraer datos
          </button>
        </div>
        <p className="text-xs text-ink/45">
          Funciona con enlaces de Idealista, Fotocasa, webs de agencias sobre
          Inmoweb y otros portales.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div className="flex-1">{error}</div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-700/60 hover:text-red-700"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <div>{success}</div>
        </div>
      )}

      {/* Paso 2: preview y edición */}
      {preview && form && (
        <div className="space-y-5 border-t border-ink/10 pt-5">
          {preview.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <div className="font-medium">Avisos del extractor</div>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Título" required>
              <input
                type="text"
                value={form.title}
                onChange={(e) =>
                  setForm({ ...form, title: e.target.value })
                }
                className={inputCls}
              />
            </Field>

            <Field label="Referencia externa" required>
              <input
                type="text"
                value={form.externalReference}
                onChange={(e) =>
                  setForm({ ...form, externalReference: e.target.value })
                }
                className={inputCls}
              />
            </Field>

            {/* Agencia: los pisos importados por link siempre se asignan
                a la agencia genérica "Portales externos". El campo se
                muestra como informativo (no editable). Para
                recategorizar, ir a la ficha del piso tras crearlo. */}
            <Field label="Agencia">
              <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-ink/[0.04] px-3 py-2 text-sm text-ink/70">
                <span>
                  {agencies.find((a) => a.slug === form.agencySlug)?.name ??
                    "Portales externos"}
                </span>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-ink/45">
                  por defecto
                </span>
              </div>
            </Field>

            <Field label="Operación" required>
              <select
                value={form.operation}
                onChange={(e) =>
                  setForm({
                    ...form,
                    operation: e.target.value as "rent" | "sale",
                  })
                }
                className={inputCls}
              >
                <option value="sale">Venta</option>
                <option value="rent">Alquiler</option>
              </select>
            </Field>

            {form.operation === "rent" && (
              <Field label="Tipo de estancia">
                <select
                  value={form.stay}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      stay: e.target.value as FormState["stay"],
                    })
                  }
                  className={inputCls}
                >
                  <option value="">—</option>
                  <option value="long">Larga estancia</option>
                  <option value="short">Corta estancia</option>
                </select>
              </Field>
            )}

            <Field label="Precio (€)" required>
              <input
                type="number"
                min={0}
                value={form.price}
                onChange={(e) =>
                  setForm({ ...form, price: e.target.value })
                }
                className={inputCls}
              />
            </Field>

            <Field label="Habitaciones" required>
              <input
                type="number"
                min={0}
                value={form.bedrooms}
                onChange={(e) =>
                  setForm({ ...form, bedrooms: e.target.value })
                }
                className={inputCls}
              />
            </Field>

            <Field label="Baños" required>
              <input
                type="number"
                min={0}
                value={form.bathrooms}
                onChange={(e) =>
                  setForm({ ...form, bathrooms: e.target.value })
                }
                className={inputCls}
              />
            </Field>

            <Field label="Superficie (m²)">
              <input
                type="number"
                min={0}
                value={form.squareMeters}
                onChange={(e) =>
                  setForm({ ...form, squareMeters: e.target.value })
                }
                className={inputCls}
              />
            </Field>

            <Field label="Zona" required>
              <input
                type="text"
                value={form.zone}
                onChange={(e) =>
                  setForm({ ...form, zone: e.target.value })
                }
                className={inputCls}
              />
            </Field>

            <Field label="Dirección" className="md:col-span-2">
              <input
                type="text"
                value={form.address}
                onChange={(e) =>
                  setForm({ ...form, address: e.target.value })
                }
                className={inputCls}
              />
            </Field>

            <Field label="Descripción" className="md:col-span-2">
              <textarea
                rows={5}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className={cn(inputCls, "min-h-[100px] resize-y")}
              />
            </Field>

            <Field
              label="Características (separadas por coma)"
              className="md:col-span-2"
            >
              <input
                type="text"
                value={form.features}
                onChange={(e) =>
                  setForm({ ...form, features: e.target.value })
                }
                placeholder="Aire acondicionado, Calefacción, Terraza"
                className={inputCls}
              />
            </Field>
          </div>

          {/* Galería con selección */}
          <div>
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-medium text-ink/80">
                <ImageIcon size={15} />
                Fotos detectadas
                <span className="text-ink/45">
                  ({form.selectedPhotos.size}/{preview.photos.length}{" "}
                  seleccionadas)
                </span>
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      selectedPhotos: new Set(
                        preview.photos.map((_, i) => i),
                      ),
                    })
                  }
                  className="text-xs text-ink/55 hover:text-ink"
                >
                  Todas
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm({ ...form, selectedPhotos: new Set() })
                  }
                  className="text-xs text-ink/55 hover:text-ink"
                >
                  Ninguna
                </button>
              </div>
            </div>
            {preview.photos.length === 0 ? (
              <p className="mt-2 text-xs text-ink/45">
                No se detectaron fotos en la página.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {preview.photos.map((p, i) => {
                  const checked = form.selectedPhotos.has(i);
                  return (
                    <button
                      key={`${p.url}-${i}`}
                      type="button"
                      onClick={() => {
                        const next = new Set(form.selectedPhotos);
                        if (checked) next.delete(i);
                        else next.add(i);
                        setForm({ ...form, selectedPhotos: next });
                      }}
                      className={cn(
                        "relative aspect-[4/3] overflow-hidden rounded-lg border-2 transition",
                        checked
                          ? "border-gold ring-2 ring-gold/30"
                          : "border-ink/10 hover:border-ink/30",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.url}
                        alt={p.alt ?? `Foto ${i + 1}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      {checked && (
                        <div className="absolute right-1 top-1 rounded-full bg-gold p-1 text-cream-50">
                          <CheckCircle2 size={12} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-ink/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-ink/55">
              Al confirmar se descargan, watermarkan y guardan las fotos
              seleccionadas. Esto puede tardar varios segundos.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setForm(null);
                  setUrl("");
                }}
                disabled={confirming}
                className="rounded-xl border border-ink/20 px-4 py-2 text-sm text-ink/70 hover:bg-ink/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={confirming}
                className="inline-flex items-center gap-2 rounded-xl bg-gold px-5 py-2 text-sm font-medium text-cream-50 transition disabled:opacity-50"
              >
                {confirming && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Crear propiedad
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm transition focus:border-gold/55 focus:outline-none";

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-ink/65">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}
