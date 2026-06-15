import "server-only";
import { createAdminClient } from "@/lib/db/admin";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any;

    const isInspo = body.isInspo === true;

    const { data: existing } =
      isInspo && body.listingId
        ? await db.from("idealista_listings").select("id").eq("id", body.listingId).limit(1).single()
        : !isInspo && body.propertyId
        ? await db.from("idealista_listings").select("id").eq("property_id", body.propertyId).limit(1).single()
        : { data: null };

    const record = {
      is_inspo: isInspo,
      inspo_title: body.inspoTitle ?? null,
      ...(!isInspo && body.propertyId ? { property_id: body.propertyId } : {}),
      reference_code: body.referenceCode ?? "",
      property_type: body.propertyType ?? "flat",
      address_street: body.addressStreet ?? "",
      address_number: body.addressNumber ?? "",
      address_postal_code: body.addressPostalCode ?? "",
      address_city: body.addressCity ?? "",
      address_block: body.addressBlock ?? "",
      address_door: body.addressDoor ?? "",
      address_visibility: body.addressVisibility ?? "exact",
      latitude: body.latitude || null,
      longitude: body.longitude || null,
      square_meters: body.squareMeters || null,
      built_square_meters: body.builtSquareMeters || null,
      floor: body.floor ?? "",
      bedrooms: body.bedrooms ?? 0,
      bathrooms: body.bathrooms ?? 0,
      condition: body.condition ?? "good",
      price: body.price || null,
      total_rental_price: body.totalRentalPrice || null,
      rental_type: body.rentalType ?? "residential",
      max_tenants: body.maxTenants || null,
      pets_allowed: body.petsAllowed ?? false,
      children_recommended: body.childrenRecommended ?? false,
      equipment_type: body.equipmentType ?? "unknown",
      windows_location: body.windowsLocation ?? "exterior",
      has_elevator: body.hasElevator ?? false,
      orientation_north: body.orientationNorth ?? false,
      orientation_south: body.orientationSouth ?? false,
      orientation_east: body.orientationEast ?? false,
      orientation_west: body.orientationWest ?? false,
      has_terrace: body.hasTerrace ?? false,
      has_balcony: body.hasBalcony ?? false,
      has_parking: body.hasParking ?? false,
      has_storage: body.hasStorage ?? false,
      has_pool: body.hasPool ?? false,
      has_garden: body.hasGarden ?? false,
      has_wardrobes: body.hasWardrobes ?? false,
      has_ac: body.hasAC ?? false,
      is_penthouse: body.isPenthouse ?? false,
      is_studio: body.isStudio ?? false,
      is_duplex: body.isDuplex ?? false,
      energy_class: body.energyClass ?? "",
      energy_performance: body.energyPerformance || null,
      emission_rating: body.emissionRating ?? "",
      emission_value: body.emissionValue || null,
      description: body.description ?? "",
      contact_id: body.contactId ?? "",
      notes: body.notes ?? "",
      photo_ids: body.photos ?? [],
      video_ids: body.videos ?? [],
      plan_ids: body.plans ?? [],
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await db.from("idealista_listings").update(record).eq("id", existing.id);
    } else {
      await db.from("idealista_listings").insert(record);
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Save idealista listing error:", error);
    return Response.json({ error: "Error al guardar el listado" }, { status: 500 });
  }
}
