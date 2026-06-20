import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-navy/10 bg-navy text-cream">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4 lg:px-10">
        <div>
          <p className="font-serif-display text-lg tracking-wide">
            BENJAMÍN COUSIÑO
          </p>
          <p className="mt-1 text-xs tracking-[0.3em] text-gold">
            PROPIEDADES
          </p>
          <p className="mt-4 text-sm text-cream/70">
            Inmuebles de lujo en España y Chile. Asesoría discreta a la
            medida de clientes exigentes.
          </p>
        </div>

        <div>
          <p className="text-sm font-semibold text-white">España</p>
          <ul className="mt-3 space-y-2 text-sm text-cream/70">
            <li>Madrid</li>
            <li>Barcelona</li>
            <li>Marbella · Costa del Sol</li>
            <li>Ibiza</li>
            <li>Palma de Mallorca</li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold text-white">Chile</p>
          <ul className="mt-3 space-y-2 text-sm text-cream/70">
            <li>Santiago</li>
            <li>Viña del Mar</li>
            <li>Sausalito</li>
            <li>La Calera</li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold text-white">Contacto</p>
          <ul className="mt-3 space-y-2 text-sm text-cream/70">
            <li>contacto@benjamincousino.com</li>
            <li>+34 600 000 000</li>
            <li>
              <Link href="/contacto" className="underline hover:text-gold">
                Solicitar consulta privada
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 px-6 py-5 text-center text-xs text-cream/50 lg:px-10">
        © {new Date().getFullYear()} Benjamín Cousiño Propiedades. Todos los
        derechos reservados.
      </div>
    </footer>
  );
}
