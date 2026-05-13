import { NextResponse } from "next/server";

import { getServerClient } from "@/lib/supabase";
import { liveStatus } from "@/lib/live";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = liveStatus();
  const client = getServerClient();
  if (!status.configured || !client) {
    return NextResponse.json({ status, rows: [] });
  }
  const { data, error } = await client.from("skus").select("*").order("sku_id");
  if (error) return NextResponse.json({ status, error: error.message, rows: [] }, { status: 500 });
  return NextResponse.json({ status, rows: data ?? [] });
}
