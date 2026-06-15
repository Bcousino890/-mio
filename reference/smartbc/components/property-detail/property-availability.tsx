"use client";

import { CalendarDays, ExternalLink, MapPin } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n/provider";
import type { Property } from "@/lib/types";
import { cn } from "@/lib/utils";

type DayState = "available" | "booked" | "unavailable";

const WEEKDAY_KEYS = [
  "detail.calendar.weekday.mon",
  "detail.calendar.weekday.tue",
  "detail.calendar.weekday.wed",
  "detail.calendar.weekday.thu",
  "detail.calendar.weekday.fri",
  "detail.calendar.weekday.sat",
  "detail.calendar.weekday.sun",
];

// Mock month: 31 days starting on a Friday (index 4) — fixed so the layout
// is deterministic across renders.
const MONTH_FIRST_WEEKDAY = 4;
const MONTH_DAYS = 31;

// Hand-picked day states so the calendar visually reads "real" without backend.
const DAY_STATES: Record<number, DayState> = {
  3: "booked",
  4: "booked",
  9: "unavailable",
  10: "unavailable",
  14: "booked",
  21: "booked",
  22: "booked",
  28: "unavailable",
};

export function PropertyAvailabilityBlock({ property }: { property: Property }) {
  return (
    <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <PropertyCalendarCard />
      <PropertyMapCard property={property} />
    </section>
  );
}

export function PropertyCalendarCard() {
  const t = useT();
  const [selected, setSelected] = useState<number | null>(null);

  const cells: ({ day: number; state: DayState } | null)[] = [];
  for (let i = 0; i < MONTH_FIRST_WEEKDAY; i++) cells.push(null);
  for (let d = 1; d <= MONTH_DAYS; d++) {
    cells.push({ day: d, state: DAY_STATES[d] ?? "available" });
  }

  return (
    <div className="rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.35)] backdrop-blur-sm md:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/15 text-gold">
            <CalendarDays size={17} strokeWidth={1.75} />
          </span>
          <div>
            <h3 className="font-serif text-lg font-medium text-ink">
              {t("detail.calendar.title")}
            </h3>
            <p className="mt-0.5 text-[12px] text-ink/60">
              {t("detail.calendar.subtitle")}
            </p>
          </div>
        </div>
        <span className="rounded-md bg-white/70 px-2.5 py-1 text-[11px] font-medium text-ink/70">
          {t("detail.calendar.month")}
        </span>
      </header>

      <div className="mt-5 grid grid-cols-7 gap-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-ink/45">
        {WEEKDAY_KEYS.map((key) => (
          <span key={key} className="py-1">
            {t(key)}
          </span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1.5">
        {cells.map((c, idx) => {
          if (!c) return <span key={`b-${idx}`} className="aspect-square" />;
          const isSelected = selected === c.day;
          const disabled =
            c.state === "booked" || c.state === "unavailable";
          return (
            <button
              key={c.day}
              type="button"
              disabled={disabled}
              onClick={() => setSelected(c.day)}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-md border text-[13px] font-medium transition",
                disabled
                  ? "cursor-not-allowed border-transparent text-ink/30"
                  : "border-gold/20 bg-white/60 text-ink hover:border-gold/55 hover:bg-white",
                c.state === "booked" &&
                  "bg-gold/15 text-gold-dark line-through decoration-gold-dark/40",
                c.state === "unavailable" && "bg-ink/5",
                isSelected &&
                  "border-ink bg-ink text-cream-50 shadow-sm hover:bg-ink",
              )}
            >
              {c.day}
            </button>
          );
        })}
      </div>

      <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-ink/65">
        <LegendDot
          color="bg-white border border-gold/30"
          label={t("detail.calendar.legend.available")}
        />
        <LegendDot
          color="bg-gold/30"
          label={t("detail.calendar.legend.booked")}
        />
        <LegendDot
          color="bg-ink/15"
          label={t("detail.calendar.legend.unavailable")}
        />
      </ul>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-3 rounded-sm", color)} />
      <span>{label}</span>
    </li>
  );
}

// Coordenadas aproximadas de cada zona (fallback si la propiedad no se
// ha geocodificado todavía). Mismas que usa el SmartLink — mantenidas en
// sync con app/compartir/[slug]/public-property-view.tsx.
const ZONE_COORDS: Record<string, { lat: number; lng: number; zoom: number }> = {
  Salamanca: { lat: 40.4264, lng: -3.684, zoom: 15 },
  Chamberí: { lat: 40.4378, lng: -3.704, zoom: 15 },
  Retiro: { lat: 40.4151, lng: -3.6814, zoom: 15 },
  Pozuelo: { lat: 40.4337, lng: -3.8087, zoom: 14 },
  Chamartín: { lat: 40.4607, lng: -3.6772, zoom: 14 },
  Centro: { lat: 40.4168, lng: -3.7038, zoom: 15 },
  "La Moraleja": { lat: 40.5197, lng: -3.6332, zoom: 14 },
};

export function PropertyMapCard({ property }: { property: Property }) {
  const t = useT();
  const hasPreciseCoords =
    typeof property.latitude === "number" &&
    typeof property.longitude === "number";
  const fallback = ZONE_COORDS[property.zone] ?? {
    lat: 40.4168,
    lng: -3.7038,
    zoom: 14,
  };
  const coords = hasPreciseCoords
    ? { lat: property.latitude as number, lng: property.longitude as number, zoom: 15 }
    : fallback;
  // Bbox alrededor del centro: márgenes calculados para que el círculo
  // cubra una zona razonable sin revelar la dirección exacta.
  const delta = 0.012 / (coords.zoom > 14 ? (coords.zoom > 15 ? 4 : 1.8) : 1);
  const bbox = [
    coords.lng - delta,
    coords.lat - delta * 0.6,
    coords.lng + delta,
    coords.lat + delta * 0.6,
  ].join(",");
  // Iframe SIN `marker=` a propósito: cubrimos la ubicación con un
  // círculo CSS para no exponer la dirección exacta al cliente final.
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik`;
  const externalHref = `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lng}#map=${coords.zoom}/${coords.lat}/${coords.lng}`;

  return (
    <div className="rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.35)] backdrop-blur-sm md:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/15 text-gold">
            <MapPin size={17} strokeWidth={1.75} />
          </span>
          <div>
            <h3 className="font-serif text-lg font-medium text-ink">
              {t("detail.map.title")}
            </h3>
            <p className="mt-0.5 text-[12px] text-ink/60">
              {property.zone}, {property.city}
            </p>
          </div>
        </div>
        <a
          href={externalHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-gold/30 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-ink/75 transition hover:border-gold/55 hover:text-ink"
        >
          <ExternalLink size={12} strokeWidth={1.75} />
          <span>{t("detail.map.openExternal")}</span>
        </a>
      </header>

      <div className="relative mt-4 aspect-[4/3] overflow-hidden rounded-xl border border-gold/15">
        <iframe
          title={`Mapa de ${property.zone}`}
          src={src}
          className="pointer-events-none h-full w-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
        {/* Círculo dorado: zona aproximada (no calle exacta). Iframe sin
            interacción para que el círculo siempre cubra la ubicación. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-28 w-28 rounded-full border-2 border-gold/80 bg-gold/15 shadow-[0_0_0_4px_rgba(212,175,127,0.18)] md:h-36 md:w-36" />
        </div>
      </div>

      <p className="mt-3 text-[12px] text-ink/60">
        {hasPreciseCoords
          ? "Zona aproximada de la propiedad. Te facilitamos la dirección exacta al coordinar la visita."
          : "Zona aproximada del barrio. Te pasaremos la dirección exacta al coordinar la visita."}
      </p>
    </div>
  );
}

function MapMockup() {
  // Stylized SVG that evokes a city map without needing a tile provider.
  return (
    <svg
      viewBox="0 0 400 300"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="map-grid"
          width="20"
          height="20"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 20 0 L 0 0 0 20"
            fill="none"
            stroke="rgba(192,164,107,0.18)"
            strokeWidth="0.6"
          />
        </pattern>
      </defs>
      <rect width="400" height="300" fill="#f4ecda" />
      <rect width="400" height="300" fill="url(#map-grid)" />
      {/* Park */}
      <path
        d="M 30 40 Q 100 20 160 60 T 250 90 Q 220 140 160 130 T 50 110 Z"
        fill="rgba(165,178,121,0.35)"
      />
      {/* Streets */}
      <g
        stroke="rgba(120,90,40,0.35)"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      >
        <path d="M 0 80 L 400 110" />
        <path d="M 0 170 L 400 200" />
        <path d="M 0 240 L 400 260" />
        <path d="M 100 0 L 110 300" />
        <path d="M 230 0 L 250 300" />
        <path d="M 320 0 L 340 300" />
      </g>
      <g stroke="rgba(120,90,40,0.18)" strokeWidth="1.5" fill="none">
        <path d="M 0 50 L 400 70" />
        <path d="M 0 130 L 400 150" />
        <path d="M 0 210 L 400 230" />
        <path d="M 60 0 L 65 300" />
        <path d="M 170 0 L 180 300" />
        <path d="M 290 0 L 300 300" />
      </g>
      {/* Pin */}
      <g transform="translate(210 165)">
        <circle r="22" fill="rgba(192,164,107,0.25)" />
        <circle r="11" fill="#1c1812" />
        <circle r="4" fill="#f4ecda" />
      </g>
    </svg>
  );
}
