import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";
import { geocodePropertyAddress } from "@/lib/geo/geocode";

export async function POST(req: Request) {
  try {
    // Verificar que sea admin
    const profile = await getCurrentProfile();
    if (!profile || profile.role !== "admin") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminClient();

    // Obtener todas las propiedades sin coordenadas (SIN LÍMITE)
    const { data: properties, error: queryErr } = await supabase
      .from("properties")
      .select("id, title, address, zone, latitude, longitude")
      .is("latitude", null);

    if (queryErr) {
      console.error("[batch-geocode] Query error:", queryErr);
      return Response.json({ error: "Query failed" }, { status: 500 });
    }

    if (!properties || properties.length === 0) {
      return Response.json({
        ok: true,
        message: "No properties without coordinates",
        total: 0,
        geocoded: 0,
      });
    }

    console.log(`[batch-geocode] Geocodifying ${properties.length} properties...`);

    let geocoded = 0;
    let failed = 0;

    // Procesar con delay para no saturar Nominatim (max 1 req/s)
    for (const prop of properties) {
      try {
        const coords = await geocodePropertyAddress({
          address: prop.address,
          zone: prop.zone || "Madrid",
        });

        if (coords) {
          // Actualizar BD
          const { error: updateErr } = await supabase
            .from("properties")
            .update({
              latitude: coords.lat,
              longitude: coords.lng,
              geocoded_at: new Date().toISOString(),
            })
            .eq("id", prop.id);

          if (!updateErr) {
            geocoded++;
            console.log(`[batch-geocode] ✓ ${prop.title} (${prop.id}): ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
          } else {
            failed++;
            console.error(`[batch-geocode] ✗ ${prop.title} (${prop.id}): Update failed`);
          }
        } else {
          failed++;
          console.warn(`[batch-geocode] ⚠ ${prop.title} (${prop.id}): Geocoding returned null`);
        }
      } catch (err) {
        failed++;
        console.error(`[batch-geocode] Error geocoding ${prop.id}:`, err);
      }

      // Esperar 1.1s para respetar el rate limit de Nominatim
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }

    return Response.json({
      ok: true,
      total: properties.length,
      geocoded,
      failed,
    });
  } catch (err) {
    console.error("[batch-geocode] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
