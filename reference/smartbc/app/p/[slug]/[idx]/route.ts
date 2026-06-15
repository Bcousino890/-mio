import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/admin";

// Proxy de fotos de propiedad. Sirve la foto en posición `idx` para la
// propiedad con `slug`, leyéndola desde Supabase Storage en streaming. El
// objetivo es que las URLs que ve el cliente sean neutras
// (`/p/titulo-3291/0.webp`) en lugar de exponer detalles internos como
// `…/properties-photos/synced/level/3415/0.webp` que delatan el portal de
// origen.
//
// Solo devuelve fotos de propiedades NO archivadas. Cache 24h en CDN.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type PhotoRow = {
  url: string;
  position: number;
  is_cover: boolean;
};

type PropertyRow = {
  id: string;
  archived_at: string | null;
  status: string;
  property_photos: PhotoRow[] | null;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; idx: string }> },
) {
  const { slug, idx } = await params;
  const position = Number.parseInt(idx, 10);
  if (!Number.isFinite(position) || position < 0) {
    return new NextResponse("bad_idx", { status: 400 });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("properties")
    .select("id, archived_at, status, property_photos(url, position, is_cover)")
    .eq("slug", slug)
    .maybeSingle();

  const row = data as unknown as PropertyRow | null;
  if (!row || row.archived_at || row.status === "archived") {
    return new NextResponse("not_found", { status: 404 });
  }

  // Ordenamos por posición y elegimos la foto del índice solicitado. Si la
  // posición concreta no existe (porque se borró una foto), devolvemos 404
  // para que el cliente no caiga en un loop esperando una imagen rota.
  // Deduplicamos por url (igual que el adapter de la galería): si hay filas
  // duplicadas en property_photos, los índices del proxy deben casar con los que
  // ve el cliente, no contar la foto repetida.
  const seenUrls = new Set<string>();
  const photos = (row.property_photos ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .filter((p) => {
      if (seenUrls.has(p.url)) return false;
      seenUrls.add(p.url);
      return true;
    });
  const photo = photos[position];
  if (!photo) {
    return new NextResponse("not_found", { status: 404 });
  }

  try {
    const upstream = await fetch(photo.url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok || !upstream.body) {
      return new NextResponse("upstream_error", { status: 502 });
    }
    const contentType = upstream.headers.get("content-type") ?? "image/webp";
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": contentType,
        // Cache largo: las fotos no cambian salvo que se vuelva a subir, y
        // en ese caso el endpoint sirve la nueva en el mismo path.
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch {
    return new NextResponse("upstream_error", { status: 502 });
  }
}
