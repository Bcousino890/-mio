import { Send, Home, Tag, Key } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageFooter } from "@/components/ui/page-footer";
import { StatCard } from "@/components/ui/stat-card";
import { createAdminClient } from "@/lib/db/admin";
import { PublicacionClient } from "./publicacion-client";

export const dynamic = "force-dynamic";

export default async function AdminPublicacionPage() {
  const supabase = createAdminClient();

  const { data: properties } = await supabase
    .from("properties")
    .select(
      "id, slug, title, zone, price, operation, bedrooms, bathrooms, square_meters, status, cover_photo_url, external_id, bc_reference, created_at",
    )
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = (properties ?? []) as Array<{
    id: string; slug: string; title: string; zone: string | null;
    price: number | null; operation: string | null; bedrooms: number | null;
    bathrooms: number | null; square_meters: number | null; status: string | null;
    cover_photo_url: string | null; external_id: string | null;
    bc_reference: string | null; created_at: string;
  }>;

  const stats = {
    total: rows.length,
    rent: rows.filter((r) => r.operation === "rent").length,
    sale: rows.filter((r) => r.operation === "sale").length,
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="publicacion.title"
        subtitleKey="publicacion.subtitle"
      />

      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={<Home size={20} strokeWidth={1.75} />}
          labelKey="publicacion.stats.total"
          helpKey="publicacion.stats.help"
          value={stats.total}
        />
        <StatCard
          icon={<Home size={20} strokeWidth={1.75} />}
          labelKey="publicacion.stats.rent"
          helpKey="publicacion.stats.help"
          value={stats.rent}
        />
        <StatCard
          icon={<Tag size={19} strokeWidth={1.75} />}
          labelKey="publicacion.stats.sale"
          helpKey="publicacion.stats.help"
          value={stats.sale}
        />
      </div>

      <PublicacionClient properties={rows} />

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}
