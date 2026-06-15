"use client";

import { cn } from "@/lib/utils";

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  /** Renders slightly larger — used for group master toggles. */
  size?: "sm" | "md";
}

/**
 * Accesible switch with the cream/ink/gold palette.
 * Gold when on, neutral ink/10 track when off.
 */
export function Toggle({
  checked,
  onChange,
  disabled,
  size = "md",
  ...rest
}: ToggleProps) {
  const trackW = size === "sm" ? "w-9" : "w-10";
  const trackH = size === "sm" ? "h-5" : "h-6";
  const knob = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  // Both sizes share the same knob travel (16px).
  const translate = "translate-x-4";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={rest["aria-label"]}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-1 focus-visible:ring-offset-cream-50",
        trackW,
        trackH,
        checked
          ? "border-gold/60 bg-gold"
          : "border-ink/15 bg-ink/10",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 inline-block transform rounded-full bg-white shadow-sm transition-transform duration-200",
          knob,
          checked ? translate : "translate-x-0",
        )}
      />
    </button>
  );
}
