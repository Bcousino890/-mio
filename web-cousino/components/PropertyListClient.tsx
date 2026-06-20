"use client";

import { useMemo, useState } from "react";
import PropertyCard from "@/components/PropertyCard";
import { convert } from "@/lib/currency";
import type { Country, Property, PropertyType } from "@/lib/properties";

const PROPERTY_TYPES: PropertyType[] = [
  "Villa",
  "Penthouse",
  "Piso de lujo",
  "Finca",
  "Mansión",
];

const PRICE_RANGES = [
  { label: "Cualquier precio", min: 0, max: Infinity },
  { label: "Hasta 2M €", min: 0, max: 2_000_000 },
  { label: "2M € – 5M €", min: 2_000_000, max: 5_000_000 },
  { label: "5M € – 10M €", min: 5_000_000, max: 10_000_000 },
  { label: "Más de 10M €", min: 10_000_000, max: Infinity },
];

type SortOption = "relevancia" | "precio-asc" | "precio-desc";

export default function PropertyListClient({
  properties,
  initialCountry,
}: {
  properties: Property[];
  initialCountry: Country | "TODOS";
}) {
  const [country, setCountry] = useState<Country | "TODOS">(initialCountry);
  const [type, setType] = useState<PropertyType | "TODOS">("TODOS");
  const [priceRangeIndex, setPriceRangeIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("relevancia");

  const results = useMemo(() => {
    const range = PRICE_RANGES[priceRangeIndex];
    const q = query.trim().toLowerCase();

    const filtered = properties.filter((property) => {
      if (country !== "TODOS" && property.country !== country) return false;
      if (type !== "TODOS" && property.type !== type) return false;

      const priceInEur = convert(property.price, property.currency, "EUR");
      if (priceInEur < range.min || priceInEur > range.max) return false;

      if (
        q &&
        !`${property.title} ${property.city} ${property.neighborhood}`
          .toLowerCase()
          .includes(q)
      )
        return false;

      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sort === "precio-asc")
        return (
          convert(a.price, a.currency, "EUR") -
          convert(b.price, b.currency, "EUR")
        );
      if (sort === "precio-desc")
        return (
          convert(b.price, b.currency, "EUR") -
          convert(a.price, a.currency, "EUR")
        );
      return Number(b.featured) - Number(a.featured);
    });

    return sorted;
  }, [properties, country, type, priceRangeIndex, query, sort]);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-6 lg:border-r lg:border-navy/10 lg:pr-8">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-navy/60">
            Buscar
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ciudad, barrio o título"
            className="mt-2 w-full rounded-md border border-navy/20 px-3 py-2 text-sm focus:border-navy focus:outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-navy/60">
            País
          </label>
          <div className="mt-2 flex gap-2">
            {(["TODOS", "ESPAÑA", "CHILE"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCountry(c)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  country === c
                    ? "border-navy bg-navy text-white"
                    : "border-navy/20 text-navy hover:border-navy"
                }`}
              >
                {c === "TODOS" ? "Todos" : c === "ESPAÑA" ? "España" : "Chile"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-navy/60">
            Tipo de propiedad
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as PropertyType | "TODOS")}
            className="mt-2 w-full rounded-md border border-navy/20 px-3 py-2 text-sm focus:border-navy focus:outline-none"
          >
            <option value="TODOS">Todos los tipos</option>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-navy/60">
            Precio (ref. EUR)
          </label>
          <select
            value={priceRangeIndex}
            onChange={(e) => setPriceRangeIndex(Number(e.target.value))}
            className="mt-2 w-full rounded-md border border-navy/20 px-3 py-2 text-sm focus:border-navy focus:outline-none"
          >
            {PRICE_RANGES.map((range, i) => (
              <option key={range.label} value={i}>
                {range.label}
              </option>
            ))}
          </select>
        </div>
      </aside>

      <div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-navy/60">
            {results.length}{" "}
            {results.length === 1
              ? "propiedad encontrada"
              : "propiedades encontradas"}
          </p>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="rounded-md border border-navy/20 px-3 py-2 text-sm focus:border-navy focus:outline-none"
          >
            <option value="relevancia">Ordenar por relevancia</option>
            <option value="precio-asc">Precio: menor a mayor</option>
            <option value="precio-desc">Precio: mayor a menor</option>
          </select>
        </div>

        {results.length === 0 ? (
          <p className="rounded-lg border border-navy/10 bg-cream p-10 text-center text-navy/60">
            No encontramos propiedades con esos criterios. Pruebe ajustando
            los filtros.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((property) => (
              <PropertyCard key={property.slug} property={property} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
