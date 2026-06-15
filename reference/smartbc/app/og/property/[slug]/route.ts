import { NextResponse } from "next/server";
import sharp from "sharp";
import { createAdminClient } from "@/lib/db/admin";
import { storedSlugFromShare } from "@/lib/share-slug";

// Endpoint público que sirve la foto principal de una propiedad como
// JPEG 1200×630 (formato estándar Open Graph). WhatsApp/Twitter/Slack
// y otros clientes prefieren JPG/PNG sobre WebP; con este endpoint
// garantizamos que la preview se renderiza en todos.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const FALLBACK_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL?.replace(/\/+$/, "") ||
  "https://portal.bcousinoprop.com";

async function getCoverUrl(slug: string): Promise<string | null> {
  const supabase = createAdminClient();
  const res = await supabase
    .from("properties")
    .select("cover_photo_url, property_photos(url, is_cover, position)")
    .eq("slug", storedSlugFromShare(slug))
    .is("archived_at", null)
    .maybeSingle();
  if (res.error || !res.data) return null;
  const row = res.data as unknown as {
    cover_photo_url: string | null;
    property_photos:
      | Array<{ url: string; is_cover: boolean; position: number }>
      | null;
  };
  if (row.cover_photo_url) return row.cover_photo_url;
  const photos = (row.property_photos ?? []).slice().sort(
    (a, b) => a.position - b.position,
  );
  return photos.find((p) => p.is_cover)?.url ?? photos[0]?.url ?? null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const coverUrl = await getCoverUrl(slug);

  // Si no hay foto, redirige al logo en /public como último recurso.
  if (!coverUrl) {
    return NextResponse.redirect(`${FALLBACK_URL}/logo.png`, 302);
  }

  try {
    const src = await fetch(coverUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!src.ok) {
      return NextResponse.redirect(`${FALLBACK_URL}/logo.png`, 302);
    }
    const buf = Buffer.from(await src.arrayBuffer());
    // 1200×630 con cover (recorta para llenar; mantiene aspecto).
    const jpeg = await sharp(buf)
      .rotate()
      .resize({ width: 1200, height: 630, fit: "cover", position: "centre" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return new NextResponse(jpeg as unknown as BodyInit, {
      headers: {
        "Content-Type": "image/jpeg",
        // Cache largo en CDNs / clientes — la foto principal cambia poco.
        // Si cambia, el slug suele cambiar también; si no, basta refresh.
        "Cache-Control": "public, max-age=86400, s-maxage=86400, immutable",
      },
    });
  } catch {
    return NextResponse.redirect(`${FALLBACK_URL}/logo.png`, 302);
  }
}
