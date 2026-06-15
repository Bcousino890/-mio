import { ArrowRight, Heart } from "lucide-react";
import Link from "next/link";
import { PropertyCard } from "@/components/property-card";
import { SectionHeader } from "@/components/section-header";
import { PageFooter } from "@/components/ui/page-footer";
import { propertyRowToClientProperty } from "@/lib/db/adapters";
import { getFavoriteProperties } from "@/lib/db/queries/favorites";
import { getCurrentUser } from "@/lib/db/queries/session";
import { FavoritosClient } from "./favoritos-client";

export const dynamic = "force-dynamic";

export default async function FavoritosPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <EmptyShell variant="signed-out" />;
  }

  const rows = await getFavoriteProperties(user.id);
  type FavRow = {
    properties:
      | (Parameters<typeof propertyRowToClientProperty>[0] & { archived_at: string | null })
      | null;
  };
  const properties = ((rows ?? []) as unknown as FavRow[])
    .map((r) => r.properties)
    .filter((p): p is NonNullable<FavRow["properties"]> => !!p && p.archived_at === null)
    .map(propertyRowToClientProperty);

  return <FavoritosClient properties={properties} />;
}

// EmptyShell se usa cuando no hay sesión: misma estética, mensaje distinto.
function EmptyShell({ variant }: { variant: "signed-out" }) {
  void variant;
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-10 md:px-8">
      <SectionHeader
        titleKey="favoritos.title"
        subtitleKey="favoritos.subtitle"
      />
      <div className="mt-12 rounded-2xl border border-gold/25 bg-cream-50/85 p-12 text-center shadow-[0_15px_40px_-25px_rgba(40,28,10,0.30)] backdrop-blur-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 text-gold">
          <Heart size={20} strokeWidth={1.5} />
        </span>
        <p className="mt-4 font-serif text-lg text-ink">Inicia sesión</p>
        <Link
          href="/login"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-sm font-medium text-cream-50 transition hover:bg-ink-soft"
        >
          <span>Login</span>
          <ArrowRight size={14} strokeWidth={1.75} className="text-gold" />
        </Link>
      </div>
      <PageFooter textKey="login.footer" />
    </div>
  );
}
