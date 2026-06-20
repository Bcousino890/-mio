import { NextResponse } from "next/server";

interface InquiryPayload {
  name?: string;
  email?: string;
  phone?: string;
  country?: string;
  purpose?: string;
  message?: string;
  nda?: boolean;
  propertySlug?: string;
}

export async function POST(request: Request) {
  const body: InquiryPayload = await request.json();

  if (!body.name || !body.email) {
    return NextResponse.json(
      { error: "Nombre y email son obligatorios." },
      { status: 400 }
    );
  }

  // TODO: persistir en base de datos y notificar al agente (email/CRM)
  // cuando exista backend. Por ahora se registra en el log del servidor.
  console.log("[inquiry]", {
    ...body,
    receivedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
