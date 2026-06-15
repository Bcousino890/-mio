import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/db/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { status, requested_at, notes } = body as {
    status?: "pending" | "confirmed" | "completed" | "cancelled";
    requested_at?: string;
    notes?: string | null;
  };

  // Build only the fields that were passed
  const updates: {
    updated_at: string;
    status?: "pending" | "confirmed" | "completed" | "cancelled";
    confirmed_at?: string;
    completed_at?: string;
    requested_at?: string;
    notes?: string | null;
  } = {
    updated_at: new Date().toISOString(),
  };
  if (status !== undefined) {
    updates.status = status;
    if (status === "confirmed") updates.confirmed_at = new Date().toISOString();
    if (status === "completed") updates.completed_at = new Date().toISOString();
  }
  if (requested_at !== undefined) updates.requested_at = requested_at;
  if (notes !== undefined) updates.notes = notes;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("visit_requests")
    .update(updates)
    .eq("id", id)
    .select(`
      id,
      client_id,
      property_id,
      requested_at,
      status,
      notes,
      confirmed_at,
      completed_at,
      created_at,
      updated_at,
      properties ( id, title, address, zone ),
      profiles!visit_requests_client_id_fkey ( id, full_name, email )
    `)
    .single();

  if (error) {
    console.error("Error updating visit:", error);
    return NextResponse.json({ error: "Error al actualizar la visita" }, { status: 500 });
  }

  return NextResponse.json({ event: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const { error } = await supabase
    .from("visit_requests")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting visit:", error);
    return NextResponse.json({ error: "Error al eliminar la visita" }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
