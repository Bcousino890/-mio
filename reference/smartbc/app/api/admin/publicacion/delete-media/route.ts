import "server-only";
import { createAdminClient } from "@/lib/db/admin";

export async function POST(req: Request) {
  try {
    const { mediaId } = await req.json();

    if (!mediaId) {
      return Response.json(
        { error: "ID de media requerido" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Obtener ruta del archivo
    const { data: media, error: fetchError } = await (supabase
      .from("property_media")
      .select("storage_path")
      .eq("id", mediaId)
      .single() as any);

    if (fetchError || !media) {
      return Response.json(
        { error: "Media no encontrada" },
        { status: 404 }
      );
    }

    // Eliminar del storage
    const { error: deleteError } = await supabase.storage
      .from("property-media")
      .remove([(media as any)?.storage_path || ""]);

    if (deleteError) {
      console.error("Storage delete error:", deleteError);
      return Response.json(
        { error: "Error al eliminar archivo" },
        { status: 500 }
      );
    }

    // Eliminar registro de BD
    const { error: dbError } = await supabase
      .from("property_media")
      .delete()
      .eq("id", mediaId);

    if (dbError) {
      console.error("DB delete error:", dbError);
      return Response.json(
        { error: "Error al eliminar registro" },
        { status: 500 }
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Delete error:", error);
    return Response.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
