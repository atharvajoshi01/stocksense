import { NextResponse } from "next/server";

import { aggregateDaily, fetchInventory, fetchOrders, isoDaysAgo, liveStatus } from "@/lib/live";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = liveStatus();
  if (!status.configured) {
    return NextResponse.json({ status, error: "Supabase not configured" }, { status: 503 });
  }

  const fromDate = isoDaysAgo(30);
  const [inventory, orders] = await Promise.all([
    fetchInventory(),
    fetchOrders({ fromDate }),
  ]);

  const avgDaily = new Map<string, number>();
  const panels = new Map<string, typeof orders>();
  for (const o of orders) {
    const k = `${o.sku}__${o.segment}`;
    if (!panels.has(k)) panels.set(k, []);
    panels.get(k)!.push(o);
  }
  for (const [k, rows] of panels) {
    const daily = aggregateDaily(rows);
    const avg = daily.length ? daily.reduce((s, d) => s + d.quantity, 0) / daily.length : 0;
    avgDaily.set(k, avg);
  }

  const rows = inventory.map((inv) => {
    const k = `${inv.sku}__${inv.segment}`;
    const avg = avgDaily.get(k) ?? 0;
    const doc = avg > 0 ? Number(inv.on_hand) / avg : Infinity;
    let risk: "high" | "medium" | "low" = "low";
    if (Number.isFinite(doc)) {
      if (doc < inv.lead_time_days) risk = "high";
      else if (doc < inv.lead_time_days * 1.5) risk = "medium";
    }
    return {
      sku: inv.sku,
      segment: inv.segment,
      on_hand: Number(inv.on_hand),
      avg_daily_demand: avg,
      days_of_cover: Number.isFinite(doc) ? doc : null,
      lead_time_days: inv.lead_time_days,
      reorder_point: Number(inv.reorder_point),
      risk,
      last_updated: inv.last_updated,
    };
  });

  return NextResponse.json({ status, rows });
}
