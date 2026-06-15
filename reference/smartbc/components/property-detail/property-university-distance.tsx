"use client";

import { Bus, Car, ExternalLink, MapPin, Train } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CAMPUS_BY_ID,
  UNIVERSITIES,
  type Campus,
} from "@/lib/data/universities";
import { estimateTimes } from "@/lib/distance/estimate";

// Componente público en la ficha de propiedad: selecciona universidad y
// mostramos un mapa con la ruta + 3 tiempos aproximados (coche, metro, bus)
// por cada campus de esa universidad. Sin llamadas a API externas: el mapa
// va con el embed gratis de Google (output=embed) y los tiempos los
// calculamos local con haversine + factores de Madrid.

type Props = {
  propertyTitle: string;
  propertyLat: number;
  propertyLng: number;
};

export function PropertyUniversityDistance({
  propertyTitle,
  propertyLat,
  propertyLng,
}: Props) {
  // Selección inicial: primera universidad del catálogo (suele ser IE).
  const [universityId, setUniversityId] = useState<string>(UNIVERSITIES[0].id);
  // El campus mostrado en el mapa cuando la uni tiene varias sedes.
  const [activeCampusId, setActiveCampusId] = useState<string>(
    UNIVERSITIES[0].campuses[0].id,
  );

  const university = useMemo(
    () => UNIVERSITIES.find((u) => u.id === universityId) ?? UNIVERSITIES[0],
    [universityId],
  );

  // Cuando cambia universidad, asegura que el activeCampus pertenece a ella.
  if (!university.campuses.some((c) => c.id === activeCampusId)) {
    setActiveCampusId(university.campuses[0].id);
  }

  const activeCampus =
    CAMPUS_BY_ID[activeCampusId]?.campus ?? university.campuses[0];

  // URL de embed gratis (sin API key). El formato `maps.google.com/maps?...&output=embed`
  // sigue funcionando sin clave; está deprecado pero no hay reemplazo gratuito
  // equivalente. Si Google lo retira, se sustituye por OpenStreetMap.
  const embedUrl = `https://maps.google.com/maps?saddr=${propertyLat},${propertyLng}&daddr=${encodeURIComponent(activeCampus.address)}&output=embed`;

  // Botón "abrir en Maps" usando el URL scheme público de Google. Cero coste,
  // sin clave, abre la app de Maps en móvil o google.com/maps en desktop.
  const externalRouteUrl = `https://www.google.com/maps/dir/?api=1&origin=${propertyLat},${propertyLng}&destination=${encodeURIComponent(activeCampus.address)}&travelmode=driving`;

  return (
    <div className="rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.35)] backdrop-blur-sm md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg font-medium text-ink">
            Distancia al campus
          </h3>
          <p className="mt-0.5 text-[12px] text-ink/60">
            Selecciona tu universidad para ver la ruta y los tiempos aproximados
            desde {propertyTitle}.
          </p>
        </div>
        <a
          href={externalRouteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-gold/30 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-ink/75 transition hover:border-gold/55 hover:text-ink"
        >
          <ExternalLink size={12} strokeWidth={1.75} />
          <span>Ver ruta en Maps</span>
        </a>
      </header>

      <div className="mt-5">
        <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/55">
          Universidad / Escuela
        </label>
        <select
          value={universityId}
          onChange={(e) => {
            setUniversityId(e.target.value);
            const next = UNIVERSITIES.find((u) => u.id === e.target.value);
            if (next) setActiveCampusId(next.campuses[0].id);
          }}
          className="mt-2 w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm text-ink transition focus:border-gold/55 focus:outline-none focus:ring-2 focus:ring-gold/20"
        >
          {UNIVERSITIES.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {/* Mapa grande full-width arriba. Antes era una columna estrecha al
          50% — ahora ocupa todo el ancho y respira mucho mejor. */}
      <div className="mt-5 aspect-[16/9] overflow-hidden rounded-xl border border-gold/15 bg-white">
        <iframe
          key={`${activeCampus.id}-${propertyLat}-${propertyLng}`}
          src={embedUrl}
          width="100%"
          height="100%"
          style={{ border: 0 }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title={`Ruta a ${activeCampus.label}`}
        />
      </div>

      {/* Tarjetas de campus en grid horizontal debajo del mapa. 1, 2 o 3
          columnas según el número de sedes. Pulsar una cambia el mapa. */}
      <div
        className={[
          "mt-4 grid gap-3",
          university.campuses.length === 1
            ? "md:grid-cols-1"
            : university.campuses.length === 2
              ? "md:grid-cols-2"
              : "md:grid-cols-3",
        ].join(" ")}
      >
        {university.campuses.map((campus) => {
          const times = estimateTimes(
            propertyLat,
            propertyLng,
            campus.lat,
            campus.lng,
          );
          const isActive = campus.id === activeCampusId;
          return (
            <button
              key={campus.id}
              type="button"
              onClick={() => setActiveCampusId(campus.id)}
              aria-pressed={isActive}
              className={[
                "overflow-hidden rounded-xl border bg-white text-left transition focus:outline-none",
                isActive
                  ? "border-gold shadow-[0_10px_30px_-15px_rgba(168,129,74,0.45)] ring-2 ring-gold/30"
                  : "border-ink/10 hover:border-gold/40 hover:shadow-[0_8px_20px_-15px_rgba(40,28,10,0.25)]",
              ].join(" ")}
            >
              <div
                className={[
                  "px-4 py-2.5 font-serif text-[13px] font-medium tracking-wide",
                  isActive
                    ? "bg-ink text-cream-50"
                    : "bg-ink/[0.92] text-cream-50",
                ].join(" ")}
              >
                {campus.label}
              </div>
              <div className="divide-y divide-ink/10">
                <ModeRow
                  icon={<Car size={16} strokeWidth={1.75} />}
                  minutes={times.car}
                  label="en coche"
                />
                <ModeRow
                  icon={<Train size={16} strokeWidth={1.75} />}
                  minutes={times.metro}
                  label="en metro"
                />
                <ModeRow
                  icon={<Bus size={16} strokeWidth={1.75} />}
                  minutes={times.bus}
                  label="en autobús"
                />
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-[11px] text-ink/45">
        <MapPin size={11} className="mt-0.5 shrink-0" />
        <span>
          Tiempos aproximados calculados sobre distancia en línea recta. Para
          una estimación exacta consulta Google Maps.
        </span>
      </p>
    </div>
  );
}

function ModeRow({
  icon,
  minutes,
  label,
}: {
  icon: React.ReactNode;
  minutes: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold/10 text-gold-dark">
        {icon}
      </span>
      <div className="flex-1">
        <div className="text-[13px] font-semibold text-ink">
          {minutes} <span className="text-[11px] font-medium text-ink/55">min</span>
        </div>
        <div className="text-[10px] uppercase tracking-[0.1em] text-ink/55">
          {label}
        </div>
      </div>
    </div>
  );
}
