import { NextResponse } from "next/server";

// Railway uses this endpoint only to determine whether the Next.js service is
// accepting requests. It intentionally avoids checking credentials, Supabase,
// or customer data so it is safe to expose publicly.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", service: "leadloop-api" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
