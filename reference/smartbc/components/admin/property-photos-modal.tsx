"use client";

import {
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deletePropertyPhoto,
  reorderPropertyPhotos,
  uploadPropertyPhoto,
} from "@/app/(admin)/admin/propiedades/actions";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export type PropertyPhoto = { url: string; isCover: boolean };

export function PropertyPhotosModal({
  open,
  onClose,
  slug,
  title,
  initialPhotos,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  title: string;
  initialPhotos: PropertyPhoto[];
}) {
  const t = useT();
  const router = useRouter();
  const [photos, setPhotos] = useState<PropertyPhoto[]>(initialPhotos);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const hasCover = photos.some((p) => p.isCover);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null);

    startTransition(async () => {
      // Subimos en serie: cada upload depende del estado de cover anterior
      // y queremos detectar el primer error sin condiciones de carrera.
      let coverAssigned = hasCover;
      for (const file of files) {
        const formData = new FormData();
        formData.set("slug", slug);
        formData.set("file", file);
        formData.set("isCover", String(!coverAssigned));

        const result = await uploadPropertyPhoto(formData);
        if (result.ok) {
          const isCover = !coverAssigned;
          coverAssigned = coverAssigned || isCover;
          setPhotos((prev) => [...prev, { url: result.url, isCover }]);
        } else {
          setError(result.error);
          break;
        }
      }
      router.refresh();
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  const handleDelete = (url: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("adminProps.photos.deleteConfirm"))
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deletePropertyPhoto({ slug, photoUrl: url });
      if (result.ok) {
        setPhotos((prev) => prev.filter((p) => p.url !== url));
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  // Persiste un nuevo orden (la 1ª pasa a ser la portada del SmartLink).
  const persistOrder = (next: PropertyPhoto[]) => {
    setPhotos(next);
    setError(null);
    startTransition(async () => {
      const res = await reorderPropertyPhotos(
        slug,
        next.map((p) => p.url),
      );
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  };

  // Reordenar arrastrando: reordenamos en LOCAL mientras se arrastra y solo
  // guardamos al soltar (evita una llamada al servidor por cada movimiento).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const orderRef = useRef(photos);
  orderRef.current = photos;

  const reorderLocal = (from: number, to: number) => {
    if (from === to) return;
    setPhotos((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      orderRef.current = next;
      return next;
    });
  };

  const persistCurrentOrder = () => {
    setError(null);
    startTransition(async () => {
      const res = await reorderPropertyPhotos(
        slug,
        orderRef.current.map((p) => p.url),
      );
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  };

  const makePrincipal = (index: number) => {
    if (index === 0) return;
    const next = [...photos];
    const [item] = next.splice(index, 1);
    next.unshift(item);
    persistOrder(next);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      isPending={isPending}
      size="3xl"
      title={t("adminProps.photos.title")}
      subtitle={title}
    >
      <div className="mt-1">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            disabled={isPending}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isPending}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gold/30 bg-white/55 px-4 py-6 text-sm font-medium text-ink/70 transition",
              "hover:border-gold/55 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isPending ? (
              <Loader2 size={16} strokeWidth={1.75} className="animate-spin text-gold" />
            ) : (
              <Upload size={16} strokeWidth={1.75} className="text-gold" />
            )}
            <span>
              {isPending
                ? t("adminProps.photos.uploading")
                : t("adminProps.photos.uploadAction")}
            </span>
          </button>
          <p className="mt-2 text-[11px] text-ink/45">
            {t("adminProps.photos.uploadHint")}
          </p>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
            {error}
          </p>
        )}

        <div className="mt-6">
          {photos.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-gold/15 bg-white/40 px-4 py-10 text-center">
              <ImageIcon
                size={28}
                strokeWidth={1.5}
                className="text-ink/30"
              />
              <p className="mt-2 text-sm text-ink/55">
                {t("adminProps.photos.empty")}
              </p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-[12px] text-ink/55">
                {t("adminProps.photos.reorderHint")}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((photo, index) => (
                  <PhotoCard
                    key={photo.url}
                    photo={photo}
                    index={index}
                    isDragging={dragIndex === index}
                    onDelete={() => handleDelete(photo.url)}
                    onMakePrincipal={() => makePrincipal(index)}
                    onDragStart={() => setDragIndex(index)}
                    onDragEnter={() => {
                      if (dragIndex !== null && dragIndex !== index) {
                        reorderLocal(dragIndex, index);
                        setDragIndex(index);
                      }
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      persistCurrentOrder();
                    }}
                    isPending={isPending}
                  />
                ))}
              </div>
            </>
          )}
        </div>
    </Modal>
  );
}

function PhotoCard({
  photo,
  index,
  isDragging,
  onDelete,
  onMakePrincipal,
  onDragStart,
  onDragEnter,
  onDragEnd,
  isPending,
}: {
  photo: PropertyPhoto;
  index: number;
  isDragging: boolean;
  onDelete: () => void;
  onMakePrincipal: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  isPending: boolean;
}) {
  const t = useT();
  const isPrincipal = index === 0;
  return (
    <div
      draggable={!isPending}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative aspect-[4/3] cursor-grab overflow-hidden rounded-xl border border-gold/15 bg-cream-100 active:cursor-grabbing",
        isDragging && "opacity-40 ring-2 ring-gold",
      )}
    >
      <Image
        src={photo.url}
        alt=""
        fill
        sizes="(max-width: 640px) 50vw, 33vw"
        className="pointer-events-none object-cover"
      />

      {/* Asa de arrastre (señal visual) */}
      <span className="absolute left-1.5 top-1.5 rounded-md bg-cream-50/85 p-1 text-ink/55 opacity-0 transition group-hover:opacity-100">
        <GripVertical size={13} strokeWidth={1.75} />
      </span>

      {isPrincipal && (
        <span className="absolute left-2 bottom-2 flex items-center gap-1 rounded-md bg-gold px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink">
          <Star size={10} strokeWidth={2} fill="currentColor" />
          {t("adminProps.photos.principal")}
        </span>
      )}

      {/* Borrar (arriba derecha) */}
      <button
        type="button"
        onClick={onDelete}
        disabled={isPending}
        aria-label={t("adminProps.photos.delete")}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-cream-50/90 text-red-600 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 disabled:opacity-30"
      >
        <Trash2 size={13} strokeWidth={1.75} />
      </button>

      {/* Hacer principal (solo si no lo es ya) */}
      {!isPrincipal && (
        <button
          type="button"
          onClick={onMakePrincipal}
          disabled={isPending}
          className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1 rounded-md bg-cream-50/95 px-2 py-1 text-[10px] font-semibold text-ink opacity-0 transition group-hover:opacity-100 hover:bg-white disabled:opacity-40"
        >
          <Star size={11} strokeWidth={2} className="text-gold" />
          {t("adminProps.photos.makePrincipal")}
        </button>
      )}
    </div>
  );
}
