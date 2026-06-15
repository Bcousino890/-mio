"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Paginación numerada con ventana alrededor de la página actual (+ primera/
// última con elipsis). Controlada: el padre lleva `page` y reacciona a onChange.
export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  const window: number[] = [];
  for (let i = start; i <= end; i++) window.push(i);

  return (
    <nav className="mt-8 flex items-center justify-center gap-1.5">
      <ArrowBtn
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        label="Anterior"
      >
        <ChevronLeft size={16} strokeWidth={1.75} />
      </ArrowBtn>

      {start > 1 && (
        <>
          <NumBtn n={1} active={page === 1} onClick={onChange} />
          {start > 2 && <span className="px-1 text-ink/40">…</span>}
        </>
      )}

      {window.map((n) => (
        <NumBtn key={n} n={n} active={n === page} onClick={onChange} />
      ))}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="px-1 text-ink/40">…</span>}
          <NumBtn
            n={totalPages}
            active={page === totalPages}
            onClick={onChange}
          />
        </>
      )}

      <ArrowBtn
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        label="Siguiente"
      >
        <ChevronRight size={16} strokeWidth={1.75} />
      </ArrowBtn>
    </nav>
  );
}

function NumBtn({
  n,
  active,
  onClick,
}: {
  n: number;
  active: boolean;
  onClick: (n: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(n)}
      className={cn(
        "h-9 min-w-9 rounded-lg border px-2 text-sm font-medium transition",
        active
          ? "border-ink bg-ink text-cream-50"
          : "border-ink/15 bg-white text-ink/70 hover:border-gold/50 hover:text-ink",
      )}
    >
      {n}
    </button>
  );
}

function ArrowBtn({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink/15 bg-white text-ink/70 transition hover:border-gold/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
