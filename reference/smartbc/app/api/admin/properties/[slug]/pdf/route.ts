import { renderToBuffer } from "@react-pdf/renderer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { createElement, type ReactElement } from "react";
import sharp from "sharp";
import { requireStaff } from "@/lib/db/auth-helpers";
import { createClient } from "@/lib/db/server";
import { getPropertyBySlugForAdmin } from "@/lib/db/queries/properties";
import { shareSlug } from "@/lib/share-slug";
import {
  PropertyPdfDocument,
  type PropertyPdfData,
} from "@/lib/pdf/property-pdf";

// Cargamos el logo del proyecto (public/logo.png) una vez por request.
// Lo pasamos como data URI al PDF para que aparezca en la cabecera.
async function loadLogoDataUri(): Promise<string | null> {
  try {
    const logoPath = path.join(process.cwd(), "public", "logo.png");
    const buf = await readFile(logoPath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// @react-pdf/renderer no soporta bien webp; convertimos a JPEG (data URI)
// antes de pasarlo al documento. Si el fetch o la conversión fallan,
// devolvemos null y el PDF se genera sin foto principal.
async function fetchPhotoAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());
    const jpegBuffer = await sharp(input)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  // Auth: solo staff puede generar PDFs (es info comercial).
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const { slug } = await params;
  const row = (await getPropertyBySlugForAdmin(slug)) as
    | (Record<string, unknown> & {
        title: string;
        operation: "rent" | "sale";
        price: number;
        zone: string;
        bedrooms: number;
        bathrooms: number;
        square_meters: number | null;
        description: string | null;
        features: string[] | null;
        cover_photo_url: string | null;
        property_photos:
          | Array<{ url: string; is_cover: boolean; position: number }>
          | null;
      })
    | null;
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Resolver portada y galería para el PDF. Bajamos en paralelo para no
  // alargar mucho la generación. Limitamos la galería a 5 extra (6 con
  // portada) para que el PDF no pese demasiado y entre en una página.
  const allPhotos = (row.property_photos ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  const coverUrl =
    row.cover_photo_url ??
    allPhotos.find((p) => p.is_cover)?.url ??
    allPhotos[0]?.url ??
    null;
  const galleryUrls = allPhotos
    .map((p) => p.url)
    .filter((u) => u !== coverUrl)
    .slice(0, 5);

  const [coverDataUri, galleryDataUris, logoDataUri] = await Promise.all([
    coverUrl ? fetchPhotoAsDataUri(coverUrl) : Promise.resolve(null),
    Promise.all(galleryUrls.map(fetchPhotoAsDataUri)),
    loadLogoDataUri(),
  ]);
  const cover = coverDataUri;
  const galleryPhotos = galleryDataUris.filter(
    (u): u is string => u !== null,
  );

  // URL pública absoluta para el "SmartLink" del PDF. Tomamos el host del
  // request si está; si no, caemos a portal.bcousinoprop.com.
  const origin =
    process.env.NEXT_PUBLIC_PORTAL_URL?.replace(/\/+$/, "") ||
    "https://portal.bcousinoprop.com";
  const smartLink = `${origin}/compartir/${shareSlug(
    slug,
    (row as { bc_reference?: string | null }).bc_reference,
  )}`;

  const data: PropertyPdfData = {
    title: row.title,
    operation: row.operation,
    price: Number(row.price),
    zone: row.zone,
    city: "Madrid",
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    squareMeters: row.square_meters,
    description: row.description,
    features: row.features ?? [],
    coverPhotoUrl: cover,
    galleryPhotos,
    logoDataUri,
    smartLink,
  };

  // renderToBuffer espera ReactElement<DocumentProps>. Nuestro componente
  // devuelve <Document>; el cast es seguro porque PropertyPdfDocument SÍ
  // renderiza un <Document> de @react-pdf — solo el tipo TS no lo refleja.
  const element = createElement(PropertyPdfDocument, {
    data,
  }) as unknown as ReactElement<{ children?: unknown }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  const safeName = row.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName || "propiedad"}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
