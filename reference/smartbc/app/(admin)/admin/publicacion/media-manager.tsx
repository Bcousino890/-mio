"use client";

import {
  Download,
  FileText,
  Loader2,
  Plus,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type MediaFile = {
  id: string;
  propertyId: string;
  type: "photo" | "video" | "plan";
  fileName: string;
  url: string;
  uploadedAt: string;
  hasWatermark?: boolean;
};

type UploadStatus = "idle" | "uploading" | "success" | "error";

export function MediaManager({
  propertyId,
  propertyTitle,
  onClose,
}: {
  propertyId: string;
  propertyTitle: string;
  onClose: () => void;
}) {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [addWatermark, setAddWatermark] = useState(true);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (!files) return;

    setUploadStatus("uploading");
    setUploadError(null);

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("propertyId", propertyId);
        formData.append("type", "photo");
        formData.append("addWatermark", String(addWatermark));

        const res = await fetch("/api/admin/publicacion/upload-media", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Error uploading file");
        }

        const newFile = await res.json();
        setMediaFiles((prev) => [...prev, newFile]);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Error desconocido"
        );
        setUploadStatus("error");
        return;
      }
    }

    setUploadStatus("success");
    setTimeout(() => setUploadStatus("idle"), 2000);
    e.currentTarget.value = "";
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (!files) return;

    setUploadStatus("uploading");
    setUploadError(null);

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("propertyId", propertyId);
        formData.append("type", "video");

        const res = await fetch("/api/admin/publicacion/upload-media", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Error uploading file");
        }

        const newFile = await res.json();
        setMediaFiles((prev) => [...prev, newFile]);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Error desconocido"
        );
        setUploadStatus("error");
        return;
      }
    }

    setUploadStatus("success");
    setTimeout(() => setUploadStatus("idle"), 2000);
    e.currentTarget.value = "";
  };

  const handlePlanUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (!files) return;

    setUploadStatus("uploading");
    setUploadError(null);

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("propertyId", propertyId);
        formData.append("type", "plan");

        const res = await fetch("/api/admin/publicacion/upload-media", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Error uploading file");
        }

        const newFile = await res.json();
        setMediaFiles((prev) => [...prev, newFile]);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Error desconocido"
        );
        setUploadStatus("error");
        return;
      }
    }

    setUploadStatus("success");
    setTimeout(() => setUploadStatus("idle"), 2000);
    e.currentTarget.value = "";
  };

  const deleteMedia = async (mediaId: string) => {
    try {
      const res = await fetch("/api/admin/publicacion/delete-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId }),
      });

      if (!res.ok) throw new Error("Error deleting file");

      setMediaFiles((prev) => prev.filter((m) => m.id !== mediaId));
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Error al eliminar"
      );
    }
  };

  const photoCount = mediaFiles.filter((m) => m.type === "photo").length;
  const videoCount = mediaFiles.filter((m) => m.type === "video").length;
  const planCount = mediaFiles.filter((m) => m.type === "plan").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm">
      <div className="relative w-full max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl bg-cream-50 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-ink/10 bg-cream-50 px-6 py-4">
          <div>
            <h2 className="font-serif text-xl font-semibold text-ink">
              Medios · {propertyTitle}
            </h2>
            <p className="mt-1 text-sm text-ink/55">
              Fotos, videos y planos con marca de agua
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-ink/40 hover:bg-ink/5 hover:text-ink"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6 p-6">
          {/* Watermark toggle */}
          <label className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <input
              type="checkbox"
              checked={addWatermark}
              onChange={(e) => setAddWatermark(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-amber-600"
            />
            <span className="text-sm text-amber-700">
              Agregar marca de agua a fotos (protege tu propiedad intelectual)
            </span>
          </label>

          {/* Fotos */}
          <div>
            <h3 className="mb-3 font-semibold text-ink">
              Fotos <span className="font-normal text-ink/55">({photoCount})</span>
            </h3>
            <div className="rounded-lg border-2 border-dashed border-ink/15 p-6 text-center">
              <label className="cursor-pointer">
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  disabled={uploadStatus === "uploading"}
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-2">
                  <Plus size={28} className="text-gold" />
                  <span className="text-sm font-medium text-ink">
                    Haz clic para subir fotos
                  </span>
                  <span className="text-[12px] text-ink/50">
                    JPG, PNG (máx 10MB cada una)
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Videos */}
          <div>
            <h3 className="mb-3 font-semibold text-ink">
              Videos <span className="font-normal text-ink/55">({videoCount})</span>
            </h3>
            <div className="rounded-lg border-2 border-dashed border-ink/15 p-6 text-center">
              <label className="cursor-pointer">
                <input
                  type="file"
                  multiple
                  accept="video/*"
                  onChange={handleVideoUpload}
                  disabled={uploadStatus === "uploading"}
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-2">
                  <Video size={28} className="text-gold" />
                  <span className="text-sm font-medium text-ink">
                    Haz clic para subir videos
                  </span>
                  <span className="text-[12px] text-ink/50">
                    MP4, WebM (máx 100MB)
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Planos */}
          <div>
            <h3 className="mb-3 font-semibold text-ink">
              Planos <span className="font-normal text-ink/55">({planCount})</span>
            </h3>
            <div className="rounded-lg border-2 border-dashed border-ink/15 p-6 text-center">
              <label className="cursor-pointer">
                <input
                  type="file"
                  multiple
                  accept=".pdf"
                  onChange={handlePlanUpload}
                  disabled={uploadStatus === "uploading"}
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-2">
                  <FileText size={28} className="text-gold" />
                  <span className="text-sm font-medium text-ink">
                    Haz clic para subir planos (PDF)
                  </span>
                  <span className="text-[12px] text-ink/50">
                    PDF (máx 20MB)
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Status messages */}
          {uploadStatus === "uploading" && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
              <Loader2 size={16} className="animate-spin" />
              Subiendo archivos...
            </div>
          )}

          {uploadStatus === "success" && (
            <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              ✓ Archivos subidos correctamente
            </div>
          )}

          {uploadError && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              Error: {uploadError}
            </div>
          )}

          {/* Media list */}
          {mediaFiles.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-ink">Archivos</h3>
              <div className="space-y-1 rounded-lg border border-ink/10 divide-y divide-ink/10">
                {mediaFiles.map((media) => (
                  <div
                    key={media.id}
                    className="flex items-center justify-between bg-white/50 px-4 py-3 text-sm"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {media.type === "photo" && (
                        <div className="h-10 w-10 shrink-0 rounded bg-blue-100 flex items-center justify-center">
                          <span className="text-[11px] font-bold text-blue-600">
                            IMG
                          </span>
                        </div>
                      )}
                      {media.type === "video" && (
                        <Video
                          size={16}
                          className="shrink-0 text-purple-600"
                        />
                      )}
                      {media.type === "plan" && (
                        <FileText
                          size={16}
                          className="shrink-0 text-red-600"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-ink font-medium">
                          {media.fileName}
                        </p>
                        {media.hasWatermark && (
                          <p className="text-[11px] text-emerald-600">
                            Con marca de agua
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={media.url}
                        download
                        className="flex items-center gap-1 rounded px-2 py-1.5 text-[12px] text-ink/65 hover:bg-ink/5 transition"
                      >
                        <Download size={12} />
                      </a>
                      <button
                        onClick={() => deleteMedia(media.id)}
                        className="flex items-center gap-1 rounded px-2 py-1.5 text-[12px] text-red-600 hover:bg-red-50 transition"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
