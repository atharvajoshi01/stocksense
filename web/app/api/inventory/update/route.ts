import { NextResponse } from "next/server";

import { getServiceClient, isServiceConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const VALID_SEGMENTS = new Set(["food_service", "healthcare"]);

export async function POST(req: Request) {
  if (!isServiceConfigured()) {
    return NextResponse.json(
      { error: "Service role key not configured on the server." },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sku = typeof body.sku === "string" ? body.sku.trim() : "";
  const segment = typeof body.segment === "string" ? body.segment.trim() : "";
  const on_hand = typeof body.on_hand === "number" ? body.on_hand : Number(body.on_hand);
  const lead_time_days =
    body.lead_time_days === undefined || body.lead_time_days === null
      ? undefined
      : Number(body.lead_time_days);
  const reorder_point =
    body.reorder_point === undefined || body.reorder_point === null
      ? undefined
      : Number(body.reorder_point);

  if (!sku) return NextResponse.json({ error: "sku is required" }, { status: 400 });
  if (!VALID_SEGMENTS.has(segment))
    return NextResponse.json({ error: "segment must be food_service or healthcare" }, { status: 400 });
  if (!Number.isFinite(on_hand) || on_hand < 0)
    return NextResponse.json({ error: "on_hand must be >= 0" }, { status: 400 });

  const client = getServiceClient()!;
  const payload: Record<string, unknown> = { sku, segment, on_hand };
  if (lead_time_days !== undefined && Number.isFinite(lead_time_days) && lead_time_days >= 0) {
    payload.lead_time_days = lead_time_days;
  } else {
    payload.lead_time_days = 14;
  }
  if (reorder_point !== undefined && Number.isFinite(reorder_point) && reorder_point >= 0) {
    payload.reorder_point = reorder_point;
  } else {
    payload.reorder_point = 0;
  }

  const { data, error } = await client
    .from("inventory")
    .upsert(payload, { onConflict: "sku,segment" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const alert =
    Number(data.on_hand) < Number(data.reorder_point)
      ? { reorder_alert: true, message: `on_hand (${data.on_hand}) < reorder_point (${data.reorder_point})` }
      : { reorder_alert: false };

  return NextResponse.json({ row: data, ...alert });
}
