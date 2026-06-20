import Image from "next/image";
import Link from "next/link";
import PropertyCard from "@/components/PropertyCard";
import { getFeaturedProperties } from "@/lib/properties";

export default function Home() {
  const featured = getFeaturedProperties();

  return (
    <div>
      <section className="relative flex min-h-[88vh] items-center justify-center overflow-hidden bg-navy text-white">
        <Image
          src="/placeholders/luxury-1.svg"
          alt="Villa de lujo"
          fill
          priority
          className="object-cover opacity-50"
        />
        <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.35em] text-gold">
            España · Chile
          </p>
          <h1 className="font-serif-display mt-4 text-4xl leading-tight sm:text-5xl lg:text-6xl">
            Lujo sin Compromisos
          </h1>
          <p className="mt-5 max-w-xl text-base text-white/80 sm:text-lg">
            Villas, áticos y fincas exclusivas, seleccionadas y verificadas
            para clientes que valoran la discreción y la excelencia.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/propiedades"
              className="rounded-full bg-gold px-7 py-3 text-sm font-semibold uppercase tracking-wide text-navy transition-opacity hover:opacity-90"
            >
              Explorar Propiedades Exclusivas
            </Link>
            <Link
              href="/contacto"
              className="rounded-full border border-white/40 px-7 py-3 text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:border-white"
            >
              Consulta Privada
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <div className="mb-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-gold">
              Selección
            </p>
            <h2 className="font-serif-display mt-2 text-3xl text-navy">
              Propiedades Destacadas
            </h2>
          </div>
          <Link
            href="/propiedades"
            className="text-sm font-medium text-navy underline-offset-4 hover:underline"
          >
            Ver todas las propiedades →
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((property) => (
            <PropertyCard key={property.slug} property={property} />
          ))}
        </div>
      </section>

      <section className="bg-cream py-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <p className="text-center text-xs font-medium uppercase tracking-[0.3em] text-gold">
            Cómo Funciona
          </p>
          <h2 className="font-serif-display mt-2 text-center text-3xl text-navy">
            Un proceso a su medida
          </h2>

          <div className="mt-12 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                step: "01",
                title: "Consulta Privada",
                text: "Compartimos sus criterios e intenciones bajo estricta confidencialidad.",
              },
              {
                step: "02",
                title: "Selección Curada",
                text: "Presentamos propiedades, incluyendo oportunidades off-market.",
              },
              {
                step: "03",
                title: "Visita VIP",
                text: "Coordinamos visitas privadas, tours 360° y due diligence completa.",
              },
              {
                step: "04",
                title: "Cierre Discreto",
                text: "Acompañamos la negociación y el cierre con asesores legales y fiscales.",
              },
            ].map((item) => (
              <div key={item.step}>
                <p className="font-serif-display text-3xl text-gold">
                  {item.step}
                </p>
                <h3 className="mt-3 text-lg font-semibold text-navy">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-navy/70">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-20 text-center lg:px-10">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-gold">
          Newsletter
        </p>
        <h2 className="font-serif-display mt-2 text-3xl text-navy">
          Insights de mercado, antes que nadie
        </h2>
        <p className="mt-4 text-navy/70">
          Reciba oportunidades off-market y análisis de mercado de España y
          Chile directamente en su correo.
        </p>
        <form className="mx-auto mt-6 flex max-w-md flex-col gap-3 sm:flex-row">
          <input
            type="email"
            required
            placeholder="Su correo electrónico"
            className="flex-1 rounded-full border border-navy/20 px-5 py-3 text-sm focus:border-navy focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-full bg-navy px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Suscribirme
          </button>
        </form>
      </section>
    </div>
  );
}
