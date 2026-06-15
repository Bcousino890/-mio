import "server-only";

export const runtime = "nodejs";

// Endpoint proxy para el volcado a Idealista. Recibe la propiedad y la clave
// API del cliente, construye el payload según la especificación de Idealista
// para importación masiva y lo envía. La clave nunca se persiste en servidor.
export async function POST(req: Request) {
  let body: { property: Record<string, unknown>; apiKey: string };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
  }

  const { property, apiKey } = body;

  if (!apiKey) {
    return Response.json({ error: "Clave API no proporcionada" }, { status: 400 });
  }
  if (!property?.id) {
    return Response.json({ error: "Propiedad inválida" }, { status: 400 });
  }

  // ── Construir payload Idealista ────────────────────────────────────────────
  // Formato estándar de volcado masivo Idealista (XML o JSON según contrato).
  // Ajustar campos según la especificación exacta entregada por Idealista.
  const operation = property.operation === "rent" ? "2" : "1"; // 1=venta, 2=alquiler
  const idealistaPayload = {
    referencia: property.bc_reference ?? property.external_id ?? property.id,
    titulo: property.title,
    descripcion: property.description ?? "",
    tipoOperacion: operation,
    precio: Number(property.price ?? 0),
    zona: property.zone ?? "",
    habitaciones: Number(property.bedrooms ?? 0),
    banos: Number(property.bathrooms ?? 0),
    metros: Number(property.square_meters ?? 0),
    fotoPrincipal: property.cover_photo_url ?? "",
  };

  try {
    // ── Llamada a Idealista API ─────────────────────────────────────────────
    // Endpoint real de volcado masivo Idealista. Requiere contrato profesional.
    // URL y formato exactos dependen del contrato — ajustar según documentación.
    const res = await fetch("https://api.idealista.com/4.5/es/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(idealistaPayload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return Response.json(
        {
          error: `Idealista rechazó la petición: HTTP ${res.status}`,
          details: text.slice(0, 200),
        },
        { status: res.status },
      );
    }

    const data = await res.json().catch(() => ({}));
    return Response.json({
      ok: true,
      idealistaId: (data as Record<string, unknown>).id ?? null,
      raw: data,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return Response.json({ error: msg }, { status: 500 });
  }
}
