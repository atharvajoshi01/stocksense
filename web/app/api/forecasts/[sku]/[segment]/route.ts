import { NextResponse } from "next/server";

import { aggregateDaily, fetchOrders, isoDaysAgo, liveStatus } from "@/lib/live";
import { forecast14d } from "@/lib/forecasting";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sku: string; segment: string }> },
) {
  const status = liveStatus();
  if (!status.configured) {
    return NextResponse.json({ status, error: "Supabase not configured" }, { status: 503 });
  }
  const { sku: rawSku, segment } = await ctx.params;
  const sku = decodeURIComponent(rawSku);

  const fromDate = isoDaysAgo(90);
  const orders = await fetchOrders({ sku, segment, fromDate });
  const daily = aggregateDaily(orders).map((d) => ({ date: d.date, quantity: d.quantity }));
  const forecast = forecast14d(daily, "ensemble", 14);

  return NextResponse.json({
    status,
    sku,
    segment,
    history: daily,
    forecast,
  });
}
