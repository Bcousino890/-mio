import Link from "next/link";

const nav = [
  { href: "/propiedades?country=ESPAÑA", label: "España" },
  { href: "/propiedades?country=CHILE", label: "Chile" },
  { href: "/propiedades", label: "Propiedades" },
  { href: "/contacto", label: "Contacto" },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-navy/10 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">
        <Link href="/" className="flex flex-col leading-tight">
          <span className="font-serif-display text-xl tracking-wide text-navy sm:text-2xl">
            BENJAMÍN COUSIÑO
          </span>
          <span className="text-[10px] font-medium tracking-[0.3em] text-gold sm:text-xs">
            PROPIEDADES
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium tracking-wide text-navy md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-gold"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/contacto"
          className="hidden rounded-full border border-navy px-5 py-2 text-sm font-medium text-navy transition-colors hover:bg-navy hover:text-white sm:inline-block"
        >
          Consulta Privada
        </Link>
      </div>
    </header>
  );
}
