"use client";

import {
  MessageSquare,
  Phone,
  X,
  Link as LinkIcon,
  Wifi,
  Home,
  DollarSign,
  User,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PLACEHOLDER_GRADIENT } from "@/lib/constants";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ParticularData = {
  id: string;
  portal: string;
  external_id: string;
  source_url: string;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  chat_only: boolean;
  zone: string | null;
  price: number | null;
  operation: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_meters: number | null;
  description: string | null;
  features: string[];
  photos: Array<{ url: string; alt?: string }>;
  advertiser_type: string;
  is_ad_professional: boolean | null;
  detected_at: string;
};

interface ParticulareDetailModalProps {
  isOpen: boolean;
  data: ParticularData | null;
  onClose: () => void;
  onCreateProperty?: (data: ParticularData) => void;
}

export function ParticulareDetailModal({
  isOpen,
  data,
  onClose,
  onCreateProperty,
}: ParticulareDetailModalProps) {
  const [imageIndex, setImageIndex] = useState(0);

  if (!isOpen || !data) return null;

  const currentPhoto = data.photos?.[imageIndex];
  const hasMultiplePhotos = (data.photos?.length ?? 0) > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header con foto */}
        <div className="relative h-80 w-full overflow-hidden bg-gray-100">
          {currentPhoto ? (
            <Image
              src={currentPhoto.url}
              alt={currentPhoto.alt || "Property"}
              fill
              className="object-cover"
            />
          ) : (
            <div className={cn("h-full w-full", PLACEHOLDER_GRADIENT)} />
          )}

          {/* Navegación de fotos */}
          {hasMultiplePhotos && (
            <>
              <button
                onClick={() =>
                  setImageIndex((i) =>
                    i === 0 ? (data.photos?.length ?? 1) - 1 : i - 1
                  )
                }
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
              >
                ←
              </button>
              <button
                onClick={() =>
                  setImageIndex((i) =>
                    i === (data.photos?.length ?? 1) - 1 ? 0 : i + 1
                  )
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
              >
                →
              </button>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
                {data.photos?.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setImageIndex(i)}
                    className={cn(
                      "h-2 w-2 rounded-full transition-colors",
                      i === imageIndex ? "bg-white" : "bg-white/50"
                    )}
                  />
                ))}
              </div>
            </>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full bg-white p-2 text-gray-800 hover:bg-gray-100"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Owner Info */}
          <div className="mb-6 border-b pb-6">
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-gray-900">
                {data.owner_name || "Sin nombre"}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {data.advertiser_type === "particular" ? "Particular" : "Profesional"}
              </p>
            </div>

            {/* Contact Info */}
            <div className="flex flex-col gap-3">
              {data.phone ? (
                <div className="flex items-center gap-3">
                  <Phone size={18} className="text-emerald-600" />
                  <a
                    href={`tel:${data.phone}`}
                    className="text-emerald-600 hover:underline"
                  >
                    {data.phone}
                  </a>
                </div>
              ) : data.chat_only ? (
                <div className="flex items-center gap-3">
                  <Wifi size={18} className="text-amber-600" />
                  <span className="text-sm text-amber-700 font-medium">
                    Solo chat disponible
                  </span>
                </div>
              ) : null}

              {data.email && (
                <a
                  href={`mailto:${data.email}`}
                  className="flex items-center gap-3 text-gray-600 hover:text-gray-900"
                >
                  <MessageSquare size={18} />
                  {data.email}
                </a>
              )}
            </div>
          </div>

          {/* Property Details */}
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {data.price && (
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <DollarSign size={16} />
                  Precio
                </div>
                <p className="mt-1 font-semibold text-gray-900">
                  {formatPrice(data.price)}
                </p>
              </div>
            )}

            {data.bedrooms !== null && (
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-sm text-gray-600">Habitaciones</div>
                <p className="mt-1 font-semibold text-gray-900">
                  {data.bedrooms}
                </p>
              </div>
            )}

            {data.bathrooms !== null && (
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-sm text-gray-600">Baños</div>
                <p className="mt-1 font-semibold text-gray-900">
                  {data.bathrooms}
                </p>
              </div>
            )}

            {data.square_meters && (
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-sm text-gray-600">m²</div>
                <p className="mt-1 font-semibold text-gray-900">
                  {data.square_meters}
                </p>
              </div>
            )}

            {data.operation && (
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-sm text-gray-600">Tipo</div>
                <p className="mt-1 font-semibold text-gray-900 capitalize">
                  {data.operation === "rent" ? "Alquiler" : "Venta"}
                </p>
              </div>
            )}

            {data.zone && (
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Home size={16} />
                  Zona
                </div>
                <p className="mt-1 font-semibold text-gray-900 line-clamp-1">
                  {data.zone}
                </p>
              </div>
            )}
          </div>

          {/* Features */}
          {data.features && data.features.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 font-semibold text-gray-900">Características</h3>
              <div className="flex flex-wrap gap-2">
                {data.features.map((feature, idx) => (
                  <span
                    key={idx}
                    className="inline-block rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-700"
                  >
                    {feature}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {data.description && (
            <div className="mb-6">
              <h3 className="mb-2 font-semibold text-gray-900">Descripción</h3>
              <p className="whitespace-pre-wrap text-sm text-gray-700">
                {data.description}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row">
            {data.phone && (
              <Button
                onClick={() => window.location.href = `tel:${data.phone}`}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              >
                <Phone size={16} className="mr-2" />
                Llamar
              </Button>
            )}

            <Button
              onClick={() => window.open(data.source_url, "_blank")}
              variant="outline"
              className="flex-1"
            >
              <LinkIcon size={16} className="mr-2" />
              Ver en {data.portal}
            </Button>

            {onCreateProperty && (
              <Button
                onClick={() => onCreateProperty(data)}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                <Home size={16} className="mr-2" />
                Crear propiedad
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
