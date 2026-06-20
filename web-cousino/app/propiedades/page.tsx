import type { Metadata } from "next";
import PropertyListClient from "@/components/PropertyListClient";
import {
  properties,
  type Country,
  type PropertyType,
} from "@/lib/properties";

const PROPERTY_TYPES: PropertyType[] = [
  "Villa",
  "Penthouse",
  "Piso de lujo",
  "Finca",
  "Mansión",
];

export const metadata: Metadata = {
  title: "Propiedades de Lujo en España y Chile | Benjamín Cousiño",
  description:
    "Explore villas, áticos, fincas y mansiones exclusivas en Madrid, Barcelona, Marbella, Ibiza, Santiago y Viña del Mar.",
};

export default async function PropiedadesPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; type?: string }>;
}) {
  const params = await searchParams;
  const initialCountry: Country | "TODOS" =
    params.country === "ESPAÑA" || params.country === "CHILE"
      ? params.country
      : "TODOS";
  const initialType: PropertyType | "TODOS" = PROPERTY_TYPES.includes(
    params.type as PropertyType
  )
    ? (params.type as PropertyType)
    : "TODOS";

  return (
    <div className="mx-auto max-w-7xl px-6 py-14 lg:px-10">
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-gold">
        Catálogo
      </p>
      <h1 className="font-serif-display mt-2 text-3xl text-navy sm:text-4xl">
        Propiedades Exclusivas
      </h1>
      <p className="mt-3 max-w-2xl text-navy/70">
        Selección curada de villas, áticos y fincas en España y Chile,
        incluyendo oportunidades off-market disponibles bajo consulta privada.
      </p>

      <div className="mt-10">
        <PropertyListClient
          properties={properties}
          initialCountry={initialCountry}
          initialType={initialType}
        />
      </div>
    </div>
  );
}
