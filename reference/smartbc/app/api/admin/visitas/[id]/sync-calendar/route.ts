import { NextResponse } from "next/server";

// Google Calendar integration has been removed.
// This route is kept as a stub to avoid 404 errors from any existing references.
// Visit management is now handled directly via /api/admin/calendario/events.
export async function POST() {
  return NextResponse.json(
    { error: "Google Calendar sync has been removed. Use the built-in calendar at /admin/calendario." },
    { status: 410 },
  );
}
