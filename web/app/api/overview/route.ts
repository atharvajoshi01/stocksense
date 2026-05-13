import { NextResponse } from "next/server";

import { aggregateDaily, fetchInventory, fetchOrders, isoDaysAgo, liveStatus } from "@/lib/live";
import { computeMAPE, ensemble } from "@/lib/forecasting";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const status = liveStatus();
  if (!status.configured) {
    return NextResponse.json({ status, error: "Supabase not configured" }, { status: 503 });
  }

  const from30 = isoDaysAgo(30);
  const from60 = isoDaysAgo(60);
  const fromHistory = isoDaysAgo(120);

  // Last 60 days of orders is enough for revenue + delta + MAPE backtest
  const [orders60, inventory] = await Promise.all([
    fetchOrders({ fromDate: from60 }),
    fetchInventory(),
  ]);

  let revenueLast30 = 0;
  let revenuePrior30 = 0;
  let unitsLast30 = 0;
  const cutoff30 = from30;
  for (const o of orders60) {
    const rev = Number(o.quantity) * Number(o.unit_price);
    if (o.order_date >= cutoff30) {
      revenueLast30 += rev;
      unitsLast30 += Number(o.quantity);
    } else {
      revenuePrior30 += rev;
    }
  }
  const revenueChangePct = revenuePrior30 > 0 ? (revenueLast30 - revenuePrior30) / revenuePrior30 : null;

  // Per-panel MAPE: hold out last 14d, predict with ensemble, score
  const history120 = await fetchOrders({ fromDate: fromHistory });
  const panels = new Map<string, typeof history120>();
  for (const o of history120) {
    const k = `${o.sku}__${o.segment}`;
    if (!panels.has(k)) panels.set(k, []);
    panels.get(k)!.push(o);
  }
  let mapeNum = 0;
  let mapeDen = 0;
  for (const [, rows] of panels) {
    const daily = aggregateDaily(rows);
    if (daily.length < 28) continue;
    const train = daily.slice(0, daily.length - 14);
    const test = daily.slice(daily.length - 14);
    const yhat = ensemble(
      train.map((d) => ({ date: d.date, quantity: d.quantity })),
      14,
    );
    const m = computeMAPE(
      test.map((d) => d.quantity),
      yhat,
    );
    if (!Number.isNaN(m)) {
      mapeNum += m;
      mapeDen += 1;
    }
  }
  const forecastMape = mapeDen ? mapeNum / mapeDen : null;

  // At-risk inventory
  const avgDailyByPanel = new Map<string, number>();
  for (const [k, rows] of panels) {
    const recent = rows.filter((r) => r.order_date >= from30);
    const avg = recent.length ? recent.reduce((s, r) => s + Number(r.quantity), 0) / Math.max(1, recent.length) : 0;
    avgDailyByPanel.set(k, avg);
  }

  const atRisk = inventory
    .map((inv) => {
      const k = `${inv.sku}__${inv.segment}`;
      const avgDaily = avgDailyByPanel.get(k) ?? 0;
      const doc = avgDaily > 0 ? Number(inv.on_hand) / avgDaily : Infinity;
      const projectedStockoutDays = Number.isFinite(doc) ? Math.max(0, 14 - doc) : 0;
      let risk: "high" | "medium" | "low" = "low";
      if (Number.isFinite(doc)) {
        if (doc < inv.lead_time_days) risk = "high";
        else if (doc < inv.lead_time_days * 1.5) risk = "medium";
      }
      return {
        sku: inv.sku,
        segment: inv.segment,
        on_hand: Number(inv.on_hand),
        avg_daily: avgDaily,
        days_of_cover: Number.isFinite(doc) ? doc : null,
        projected_stockout_days: projectedStockoutDays,
        lead_time_days: inv.lead_time_days,
        risk,
      };
    })
    .sort((a, b) => b.projected_stockout_days - a.projected_stockout_days);

  const highRiskSkus = atRisk.filter((r) => r.risk === "high").length;

  return NextResponse.json({
    status,
    generated_at: new Date().toISOString(),
    kpis: {
      revenue_last_30d: revenueLast30,
      revenue_prior_30d: revenuePrior30,
      revenue_change_pct: revenueChangePct,
      units_last_30d: unitsLast30,
      forecast_mape: forecastMape,
      high_risk_skus: highRiskSkus,
    },
    at_risk: atRisk.slice(0, 12),
  });
}
