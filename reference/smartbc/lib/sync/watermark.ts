import "server-only";
import sharp from "sharp";
import { createAdminClient } from "@/lib/db/admin";
import { removeKnownWatermark } from "./watermark-removal";

const BUCKET = "properties-photos";
const MAX_WIDTH = 1920;
const WEBP_QUALITY = 82;

export type WatermarkedPhoto = {
  url: string;
  storagePath: string;
};

export type WatermarkResult =
  | { ok: true; photo: WatermarkedPhoto }
  | { ok: false; error: string };

export async function downloadAndWatermark(params: {
  sourceUrl: string;
  agencySlug: string;
  externalId: string;
  position: number;
}): Promise<WatermarkResult> {
  try {
    // Timeout por foto: si el servidor de origen se cuelga, no queremos que el
    // import entero se quede esperando indefinidamente (era una causa de que
    // "crear propiedad" tardase muchísimo y acabara reventando el cliente).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(params.sourceUrl, {
        headers: {
          "User-Agent": "smartbc-bot/1.0 (contacto@bcousinoprop.com)",
        },
        cache: "no-store",
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return { ok: false, error: `fetch_${res.status}` };
    }

    const rawBuf = Buffer.from(await res.arrayBuffer());
    // Si la fuente tiene marca de agua constante (ej. Clikalia), la quitamos
    // antes de procesar. Si no, devuelve el buffer igual.
    const buf = await removeKnownWatermark(params.sourceUrl, rawBuf);
    const image = sharp(buf, { failOn: "none" }).rotate();
    const meta = await image.metadata();
    const targetWidth = Math.min(meta.width ?? MAX_WIDTH, MAX_WIDTH);

    // Sin marca de agua propia: las imágenes vienen ya limpias del CDN de
    // Mobilia (sufijo `-original.jpg`) y queremos mostrarlas tal cual. Sharp
    // solo redimensiona a 1920px máx y convierte a webp para optimizar peso.
    const output = await image
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    const storagePath = `synced/${params.agencySlug}/${params.externalId}/${params.position}.webp`;
    const supabase = createAdminClient();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, output, {
        contentType: "image/webp",
        upsert: true,
      });
    if (uploadError) {
      return { ok: false, error: uploadError.message };
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    return {
      ok: true,
      photo: { url: data.publicUrl, storagePath },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "watermark_unknown_error",
    };
  }
}
