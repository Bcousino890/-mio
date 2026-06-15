import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";

const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

export async function POST(req: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const slug = formData.get("slug") as string | null;

    if (!file) return Response.json({ error: "file_required" }, { status: 400 });
    if (!slug) return Response.json({ error: "slug_required" }, { status: 400 });
    if (file.size === 0) return Response.json({ error: "file_empty" }, { status: 400 });
    if (file.size > MAX_VIDEO_SIZE) {
      return Response.json(
        { error: `Archivo muy grande (máx 500MB). Usa YouTube o Vimeo para vídeos más grandes.` },
        { status: 413 }
      );
    }
    if (file.type && !ALLOWED_TYPES.includes(file.type)) {
      return Response.json({ error: "Formato no soportado. Usa MP4, MOV o WebM." }, { status: 400 });
    }

    const admin = createAdminClient() as any;

    // Resolver propertyId desde slug
    const { data: propData, error: propErr } = await admin
      .from("properties")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (propErr || !propData) {
      return Response.json({ error: "property_not_found" }, { status: 404 });
    }

    const propId = propData.id;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const storagePath = `${propId}/video/${Date.now()}-${safeName}`;

    const { error: uploadErr } = await admin.storage
      .from("properties-photos")
      .upload(storagePath, file, { contentType: file.type || "video/mp4", upsert: false });

    if (uploadErr) {
      console.error("[upload-video] storage error:", uploadErr);
      const msg: string = uploadErr.message ?? "";
      if (/too large|size|exceeds/i.test(msg)) {
        return Response.json(
          { error: "Vídeo demasiado grande para el servidor. Usa YouTube o Vimeo y pega el enlace." },
          { status: 413 }
        );
      }
      return Response.json({ error: uploadErr.message || "Error al subir" }, { status: 500 });
    }

    const { data: urlData } = admin.storage.from("properties-photos").getPublicUrl(storagePath);
    const publicUrl = urlData.publicUrl;

    const { data, error: dbErr } = await admin
      .from("property_media")
      .insert({
        property_id: propId,
        type: "video",
        file_name: file.name,
        storage_path: storagePath,
        url: publicUrl,
      })
      .select()
      .single();

    if (dbErr) {
      console.error("[upload-video] db error:", dbErr);
      return Response.json({ error: dbErr.message }, { status: 500 });
    }

    return Response.json({
      ok: true,
      item: {
        id: data.id,
        url: data.url,
        file_name: data.file_name,
        type: "video",
        storage_path: data.storage_path,
      },
    });
  } catch (err) {
    console.error("[upload-video] unexpected error:", err);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
