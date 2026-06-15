import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { randomUUID } from "crypto";

const MAX_FILE_SIZES = {
  photo: 10 * 1024 * 1024, // 10MB
  video: 100 * 1024 * 1024, // 100MB
  plan: 20 * 1024 * 1024, // 20MB
};

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const propertyId = formData.get("propertyId") as string;
    const type = formData.get("type") as "photo" | "video" | "plan";
    const addWatermark = formData.get("addWatermark") === "true";

    if (!file || !propertyId || !type) {
      return Response.json(
        { error: "Faltan parámetros requeridos" },
        { status: 400 }
      );
    }

    const maxSize = MAX_FILE_SIZES[type];
    if (file.size > maxSize) {
      return Response.json(
        { error: `Archivo demasiado grande (máx ${maxSize / 1024 / 1024}MB)` },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const bucket = "property-media";
    const fileName = `${propertyId}/${type}/${randomUUID()}-${file.name}`;

    // Subir archivo a Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(fileName, file, { upsert: false });

    if (uploadError) {
      console.error("Storage error:", uploadError);
      return Response.json(
        { error: "Error al subir archivo" },
        { status: 500 }
      );
    }

    // Obtener URL pública
    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(fileName);

    // Guardar registro en BD
    const { data, error: dbError } = await (supabase
      .from("property_media")
      .insert({
        property_id: propertyId,
        type,
        file_name: file.name,
        storage_path: fileName,
        url: publicUrl,
        has_watermark: addWatermark && type === "photo",
      } as any)
      .select()
      .single() as any);

    if (dbError) {
      console.error("DB error:", dbError);
      return Response.json(
        { error: "Error al guardar en base de datos" },
        { status: 500 }
      );
    }

    return Response.json({
      id: (data as any)?.id || randomUUID(),
      propertyId: (data as any)?.property_id || propertyId,
      type: (data as any)?.type || type,
      fileName: (data as any)?.file_name || file.name,
      url: (data as any)?.url || publicUrl,
      uploadedAt: (data as any)?.created_at || new Date().toISOString(),
      hasWatermark: (data as any)?.has_watermark || (addWatermark && type === "photo"),
    });
  } catch (error) {
    console.error("Upload error:", error);
    return Response.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
