import { NextResponse } from "next/server";

import { getServerClient } from "@/lib/supabase";
import { liveStatus } from "@/lib/live";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = liveStatus();
  const client = getServerClient();
  if (!status.configured || !client) {
    return NextResponse.json({ status, error: "Supabase not configured" }, { status: 503 });
  }

  const { data, error } = await client
    .from("anomalies")
    .select("*")
    .order("detected_at", { ascending: false })
    .limit(200);
  if (error) {
    return NextResponse.json({ status, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status, rows: data ?? [] });
}
