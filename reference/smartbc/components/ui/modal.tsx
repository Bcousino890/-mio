"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  /** Bloquea click-fuera y botón cerrar mientras la mutación está en curso */
  isPending?: boolean;
  title: string;
  /** Subtítulo bajo el título (e.g. nombre de la propiedad) */
  subtitle?: string;
  /** Anchura máxima del contenido. Por defecto "lg" (max-w-lg). */
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  children: React.ReactNode;
};

const SIZE_CLASS: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
};

/**
 * Diálogo modal reutilizable. Renderiza con createPortal en `document.body`
 * para evitar quedar atrapado por ancestros con `backdrop-filter`/`transform`
 * que crean nuevos containing blocks para `fixed`. Bloquea el scroll del
 * body mientras está abierto.
 */
export function Modal({
  open,
  onClose,
  isPending = false,
  title,
  subtitle,
  size = "lg",
  children,
}: ModalProps) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/70 p-4 backdrop-blur-sm md:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      <div
        className={cn(
          "relative my-auto w-full rounded-2xl border border-gold/20 bg-cream-50 p-6 shadow-[0_30px_80px_-25px_rgba(40,28,10,0.5)] md:p-8",
          SIZE_CLASS[size],
        )}
      >
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-serif text-xl font-medium text-ink md:text-2xl">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 truncate text-sm text-ink/60">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            disabled={isPending}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink/55 transition hover:bg-ink/5 hover:text-ink disabled:opacity-40"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </header>

        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
