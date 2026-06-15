import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/server";
import { requireStaff } from "@/lib/db/auth-helpers";
import { createAdminClient } from "@/lib/db/admin";
import { storedSlugFromShare } from "@/lib/share-slug";

export const dynamic = "force-dynamic";

// GET /api/admin/search/property?ref=BC-2024-0001
// Looks up a property by bc_reference, slug (direct or compartir URL form),
// or particular_reference (PART-YYYY-NNNN).
// Returns a compact card payload for the PropertyPreviewCard component.

type PropertyRow = {
  id: string;
  slug: string;
  title: string;
  zone: string;
  operation: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  square_meters: number | null;
  cover_photo_url: string | null;
  bc_reference: string;
  status: string;
};

type PartRow = {
  id: string;
  zone: string | null;
  operation: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_meters: number | null;
  description: string | null;
  photos: Array<{ url: string; alt?: string }> | null;
  particular_reference: string | null;
  source_url: string;
};

export async function GET(req: Request) {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(req.url);
  const ref = url.searchParams.get("ref")?.trim();

  if (!ref) {
    return NextResponse.json(
      { error: "ref param required" },
      { status: 400 },
    );
  }

  // ── 1. PART-YYYY-NNNN → look up in particulares ──────────────────────────
  if (/^PART-\d{4}-\d+$/i.test(ref)) {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAny = admin as any;
    const { data, error } = await sbAny
      .from("particulares")
      .select(
        "id, zone, operation, price, bedrooms, bathrooms, square_meters, description, photos, particular_reference, source_url",
      )
      .ilike("particular_reference", ref)
      .maybeSingle() as { data: PartRow | null; error: { message: string } | null };

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const descSnippet = data.description?.slice(0, 80) ?? null;

    return NextResponse.json({
      type: "particular",
      id: data.id,
      title: descSnippet
        ? `${data.zone ?? "Particular"} — ${descSnippet}…`
        : `Particular ${data.zone ?? ""}`.trim(),
      zone: data.zone ?? null,
      operation: data.operation ?? null,
      price: data.price ?? null,
      bedrooms: data.bedrooms ?? null,
      bathrooms: data.bathrooms ?? null,
      squareMeters: data.square_meters ?? null,
      coverPhotoUrl: data.photos?.[0]?.url ?? null,
      bcReference: null,
      partReference: data.particular_reference ?? ref,
      status: "active",
      shareUrl: data.source_url,
    });
  }

  // ── 2. BC-YYYY-NNNN → look up by bc_reference ────────────────────────────
  if (/^BC-\d{4}-\d+$/i.test(ref)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAny = supabase as any;
    const { data, error } = await sbAny
      .from("properties")
      .select(
        "id, slug, title, zone, operation, price, bedrooms, bathrooms, square_meters, cover_photo_url, bc_reference, status",
      )
      .ilike("bc_reference", ref)
      .is("archived_at", null)
      .maybeSingle() as { data: PropertyRow | null; error: { message: string } | null };

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({
      type: "property",
      id: data.id,
      title: data.title,
      zone: data.zone,
      operation: data.operation,
      price: data.price,
      bedrooms: data.bedrooms,
      bathrooms: data.bathrooms,
      squareMeters: data.square_meters,
      coverPhotoUrl: data.cover_photo_url,
      bcReference: data.bc_reference,
      partReference: null,
      status: data.status,
      shareUrl: `/compartir/${data.slug}`,
    });
  }

  // ── 3. Slug (from /compartir/slug or /propiedades/slug) ──────────────────
  // Strip the bc prefix if present (e.g. "bc0871-alquiler-de-piso...")
  const cleanedSlug = storedSlugFromShare(ref);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;
  const { data, error } = await sbAny
    .from("properties")
    .select(
      "id, slug, title, zone, operation, price, bedrooms, bathrooms, square_meters, cover_photo_url, bc_reference, status",
    )
    .eq("slug", cleanedSlug)
    .is("archived_at", null)
    .maybeSingle() as { data: PropertyRow | null; error: { message: string } | null };

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    type: "property",
    id: data.id,
    title: data.title,
    zone: data.zone,
    operation: data.operation,
    price: data.price,
    bedrooms: data.bedrooms,
    bathrooms: data.bathrooms,
    squareMeters: data.square_meters,
    coverPhotoUrl: data.cover_photo_url,
    bcReference: data.bc_reference,
    partReference: null,
    status: data.status,
    shareUrl: `/compartir/${data.slug}`,
  });
}
