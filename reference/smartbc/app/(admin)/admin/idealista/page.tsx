import Link from "next/link";
import { Settings, Sparkles } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageFooter } from "@/components/ui/page-footer";
import { createAdminClient } from "@/lib/db/admin";
import { IdealistaClient } from "./idealista-client";

export const dynamic = "force-dynamic";

export default async function AdminIdealistaPage() {
  const supabase = createAdminClient();

  // Obtener propiedades propias para publicar
  const { data: properties } = await supabase
    .from("properties")
    .select(
      "id, slug, title, zone, price, operation, bedrooms, bathrooms, square_meters, status, cover_photo_url, bc_reference, created_at"
    )
    .not("bc_reference", "is", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  // Obtener listados ya preparados para Idealista
  const { data: listings } = await supabase
    .from("idealista_listings")
    .select("*")
    .order("updated_at", { ascending: false });

  const rows = (properties ?? []) as Array<{
    id: string;
    slug: string;
    title: string;
    zone: string | null;
    price: number | null;
    operation: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    square_meters: number | null;
    status: string | null;
    cover_photo_url: string | null;
    bc_reference: string | null;
    created_at: string;
  }>;

  const idealista = (listings ?? []) as Array<{
    id: string;
    property_id: string | null;
    is_inspo: boolean;
    inspo_title: string | null;
    property_type: string | null;
    address_street: string | null;
    address_number: string | null;
    address_postal_code: string | null;
    address_city: string | null;
    address_block: string | null;
    address_door: string | null;
    address_visibility: string | null;
    square_meters: number | null;
    built_square_meters: number | null;
    floor: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    condition: string | null;
    price: number | null;
    total_rental_price: number | null;
    rental_type: string | null;
    max_tenants: number | null;
    pets_allowed: boolean;
    children_recommended: boolean;
    equipment_type: string | null;
    windows_location: string | null;
    has_elevator: boolean;
    orientation_north: boolean;
    orientation_south: boolean;
    orientation_east: boolean;
    orientation_west: boolean;
    has_terrace: boolean;
    has_balcony: boolean;
    has_parking: boolean;
    has_storage: boolean;
    has_pool: boolean;
    has_garden: boolean;
    has_wardrobes: boolean;
    has_ac: boolean;
    is_penthouse: boolean;
    is_studio: boolean;
    is_duplex: boolean;
    energy_class: string | null;
    energy_performance: number | null;
    emission_rating: string | null;
    emission_value: number | null;
    contact_id: string | null;
    notes: string | null;
    photo_ids: string[];
    video_ids: string[];
    plan_ids: string[];
    idealista_property_id: string | null;
    idealista_state: string | null;
    reference_code: string | null;
    created_at: string;
    updated_at: string;
  }>;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="admin.nav.idealista"
        subtitleKey="Prepara y publica anuncios en Idealista"
      />

      <div className="mt-7 rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-gold" />
            <h2 className="font-serif text-lg font-semibold text-ink">
              Publicar en Idealista
            </h2>
          </div>
          <Link
            href="/admin/idealista/configuracion"
            className="flex items-center gap-1.5 rounded-lg border border-ink/10 bg-white/60 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:bg-white hover:text-ink"
          >
            <Settings size={13} />
            Configuración API
          </Link>
        </div>
        <p className="mb-6 text-sm text-ink/60">
          Selecciona una propiedad, completa los datos de Idealista y sube fotos, videos y planos. Los datos quedan guardados y listos para publicar.
        </p>

        <IdealistaClient properties={rows} listings={idealista} />
      </div>

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}
