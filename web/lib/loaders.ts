/**
 * Page-side data loaders. Try live Supabase first; on any miss or failure,
 * fall back to the pre-baked snapshot under public/data.
 */
import fs from "fs/promises";
import path from "path";

import {
  getServerClient,
  isSupabaseConfigured,
  type InventoryRow as DbInventoryRow,
  type OrderRow,
  type SkuRow,
} from "./supabase";
import { aggregateDaily, isoDaysAgo } from "./live";

/**
 * Page-through an "orders" select that uses sku/segment/fromDate filters.
 * Supabase defaults to 1000 rows per response — anything bigger needs .range().
 */
async function pageOrders(opts: {
  columns: string;
  fromDate?: string;
  sku?: string;
  segment?: string;
  cap?: number;
}): Promise<Array<Record<string, unknown>>> {
  const client = getServerClient();
  if (!client) return [];
  const cap = opts.cap ?? 60_000;
  const pageSize = 1000;
  const out: Array<Record<string, unknown>> = [];
  let from = 0;
  while (out.length < cap) {
    let q = client.from("orders").select(opts.columns).order("order_date", { ascending: true });
    if (opts.fromDate) q = q.gte("order_date", opts.fromDate);
    if (opts.sku) q = q.eq("sku", opts.sku);
    if (opts.segment) q = q.eq("segment", opts.segment);
    q = q.range(from, from + pageSize - 1);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as Array<Record<string, unknown>>));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
import { forecast14d, computeMAPE, ensemble } from "./forecasting";

const DATA_DIR = path.join(process.cwd(), "public", "data");

async function readJson<T>(file: string): Promise<T> {
  const raw = await fs.readFile(path.join(DATA_DIR, file), "utf-8");
  return JSON.parse(raw) as T;
}

export type Source = "supabase" | "snapshot";

export type KpiBlock = {
  source: Source;
  revenue_last_30d: number;
  revenue_prior_30d: number;
  revenue_change_pct: number | null;
  units_last_30d: number;
  forecast_mape: number | null;
  forecast_bias: number;
  high_risk_skus: number;
  decelerating_skus: number;
  accelerating_skus: number;
  generated_at: string;
};

export type Meta = {
  source: Source;
  generated_at: string;
  start_date: string;
  end_date: string;
  n_orders: number;
  n_skus: number;
  n_segments: number;
  catalog: Array<{
    sku_id: string;
    name: string;
    product_family: string;
    primary_segment: "food_service" | "healthcare";
    lead_time_days: number;
    case_pack: number;
    unit_cost: number;
  }>;
};

export type InventoryRow = {
  sku_id: string;
  segment: "food_service" | "healthcare";
  units_on_hand: number;
  avg_daily_forecast: number;
  days_of_cover: number;
  projected_stockout_days: number;
  lead_time_days: number;
  stockout_risk: "low" | "medium" | "high";
};

export type ForecastPanel = {
  sku_id: string;
  segment: "food_service" | "healthcare";
  sigma: number;
  points: Array<{
    date: string;
    actual: number | null;
    forecast: number | null;
    lower: number | null;
    upper: number | null;
  }>;
};

export type AnomalyRow = {
  sku_id: string;
  segment: "food_service" | "healthcare";
  order_date: string;
  units_actual: number;
  units_pred: number;
  residual: number;
  z: number;
  direction: "surge" | "shortfall";
};

export type SlowMoverRow = {
  sku_id: string;
  segment: "food_service" | "healthcare";
  baseline_daily: number;
  recent_daily: number;
  delta_pct: number | null;
  movement: "accelerating" | "stable" | "decelerating";
};

export type Winner = { sku_id: string; segment: string; winner: string };
export type LeaderboardEntry = {
  forecaster: string;
  overall: { mape: number; rmse: number; bias: number; n: number };
  per_sku: Array<{
    sku_id: string;
    segment: string;
    mape: number | null;
    rmse: number;
    bias: number;
    n: number;
  }>;
};
export type DataQuality = {
  passed: boolean;
  n_findings: number;
  n_failed: number;
  findings: Array<{ name: string; passed: boolean; detail: string; offending_rows: number }>;
};
export type RevenueShare = {
  sku_id: string;
  revenue: number;
  share: number;
  cumulative_share: number;
};

// ---------- META ----------
export async function loadMeta(): Promise<Meta> {
  if (isSupabaseConfigured()) {
    const client = getServerClient()!;
    const [{ data: skus }, { data: orderBounds, error }, { count }] = await Promise.all([
      client.from("skus").select("*").order("sku_id"),
      client
        .from("orders")
        .select("order_date")
        .order("order_date", { ascending: true })
        .limit(1),
      client.from("orders").select("id", { count: "exact", head: true }),
    ]);
    const { data: lastBound } = await client
      .from("orders")
      .select("order_date")
      .order("order_date", { ascending: false })
      .limit(1);

    if (!error && skus && skus.length > 0) {
      const start =
        orderBounds && orderBounds.length ? (orderBounds[0] as { order_date: string }).order_date : isoDaysAgo(540);
      const end =
        lastBound && lastBound.length
          ? (lastBound[0] as { order_date: string }).order_date
          : new Date().toISOString().slice(0, 10);
      return {
        source: "supabase",
        generated_at: new Date().toISOString(),
        start_date: start,
        end_date: end,
        n_orders: count ?? 0,
        n_skus: skus.length,
        n_segments: 2,
        catalog: (skus as SkuRow[]).map((s) => ({
          sku_id: s.sku_id,
          name: s.name,
          product_family: s.product_family,
          primary_segment: s.primary_segment,
          lead_time_days: s.lead_time_days,
          case_pack: s.case_pack,
          unit_cost: Number(s.unit_cost),
        })),
      };
    }
  }
  const snap = await readJson<Omit<Meta, "source">>("meta.json");
  return { ...snap, source: "snapshot" };
}

// ---------- INVENTORY ----------
async function liveInventory(): Promise<InventoryRow[] | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getServerClient()!;
  const [invRes, orderRows] = await Promise.all([
    client.from("inventory").select("*"),
    pageOrders({ columns: "sku,segment,quantity,order_date", fromDate: isoDaysAgo(30) }),
  ]);
  const { data: invRows, error: invErr } = invRes;
  if (invErr || !invRows) return null;

  const byPanel = new Map<string, number[]>();
  for (const o of orderRows) {
    const k = `${o.sku}__${o.segment}`;
    if (!byPanel.has(k)) byPanel.set(k, []);
    byPanel.get(k)!.push(Number(o.quantity));
  }

  const rows: InventoryRow[] = (invRows as DbInventoryRow[]).map((inv) => {
    const k = `${inv.sku}__${inv.segment}`;
    const qs = byPanel.get(k) ?? [];
    const avg = qs.length ? qs.reduce((s, q) => s + q, 0) / qs.length : 0;
    const doc = avg > 0 ? Number(inv.on_hand) / avg : Infinity;
    const projected = Number.isFinite(doc) ? Math.max(0, 14 - doc) : 0;
    let risk: "high" | "medium" | "low" = "low";
    if (Number.isFinite(doc)) {
      if (doc < inv.lead_time_days) risk = "high";
      else if (doc < inv.lead_time_days * 1.5) risk = "medium";
    }
    return {
      sku_id: inv.sku,
      segment: inv.segment,
      units_on_hand: Number(inv.on_hand),
      avg_daily_forecast: avg,
      days_of_cover: Number.isFinite(doc) ? doc : Number.POSITIVE_INFINITY,
      projected_stockout_days: projected,
      lead_time_days: inv.lead_time_days,
      stockout_risk: risk,
    };
  });
  return rows;
}

export async function loadInventory(): Promise<{ rows: InventoryRow[]; source: Source }> {
  const live = await liveInventory();
  if (live && live.length > 0) return { rows: live, source: "supabase" };
  const rows = (await readJson<InventoryRow[]>("inventory.json")).map((r) => ({
    ...r,
    days_of_cover: r.days_of_cover === null ? Number.POSITIVE_INFINITY : r.days_of_cover,
  }));
  return { rows, source: "snapshot" };
}

// ---------- KPIS ----------
async function liveKpis(): Promise<KpiBlock | null> {
  if (!isSupabaseConfigured()) return null;
  const from60 = isoDaysAgo(60);
  const cutoff30 = isoDaysAgo(30);
  const orders60 = await pageOrders({
    columns: "sku,segment,quantity,unit_price,order_date",
    fromDate: from60,
  });
  let revenueLast30 = 0;
  let revenuePrior30 = 0;
  let unitsLast30 = 0;
  for (const o of orders60) {
    const rev = Number(o.quantity) * Number(o.unit_price);
    if ((o as unknown as OrderRow).order_date >= cutoff30) {
      revenueLast30 += rev;
      unitsLast30 += Number(o.quantity);
    } else {
      revenuePrior30 += rev;
    }
  }
  const revenueChangePct = revenuePrior30 > 0 ? (revenueLast30 - revenuePrior30) / revenuePrior30 : null;

  // Per-panel MAPE backtest: train on first 76 days, test on last 14 days
  const fromHistory = isoDaysAgo(120);
  const hist = await pageOrders({
    columns: "sku,segment,quantity,order_date",
    fromDate: fromHistory,
  });
  let mapeNum = 0;
  let mapeDen = 0;
  if (hist.length) {
    const panels = new Map<string, OrderRow[]>();
    for (const o of hist as unknown as OrderRow[]) {
      const k = `${o.sku}__${o.segment}`;
      if (!panels.has(k)) panels.set(k, []);
      panels.get(k)!.push(o);
    }
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
  }
  const forecastMape = mapeDen ? mapeNum / mapeDen : null;

  const inv = await liveInventory();
  const highRisk = inv ? inv.filter((r) => r.stockout_risk === "high").length : 0;

  return {
    source: "supabase",
    revenue_last_30d: revenueLast30,
    revenue_prior_30d: revenuePrior30,
    revenue_change_pct: revenueChangePct,
    units_last_30d: unitsLast30,
    forecast_mape: forecastMape,
    forecast_bias: 0,
    high_risk_skus: highRisk,
    decelerating_skus: 0,
    accelerating_skus: 0,
    generated_at: new Date().toISOString(),
  };
}

export async function loadKpis(): Promise<KpiBlock> {
  const live = await liveKpis();
  if (live) return live;
  const snap = await readJson<{
    revenue_last_30d: number;
    revenue_prior_30d: number;
    revenue_change_pct: number | null;
    units_last_30d: number;
    forecast_mape: number;
    forecast_bias: number;
    high_risk_skus: number;
    decelerating_skus: number;
    accelerating_skus: number;
  }>("kpis.json");
  return { ...snap, source: "snapshot", generated_at: new Date().toISOString() };
}

// ---------- FORECASTS ----------
async function liveForecast(sku: string, segment: string): Promise<ForecastPanel | null> {
  if (!isSupabaseConfigured()) return null;
  const fromDate = isoDaysAgo(120);
  const data = await pageOrders({
    columns: "sku,segment,quantity,order_date",
    sku,
    segment,
    fromDate,
  });
  if (data.length === 0) return null;
  const daily = aggregateDaily(data as unknown as OrderRow[]);
  const history = daily.map((d) => ({ date: d.date, quantity: d.quantity }));
  const fc = forecast14d(history, "ensemble", 14);
  const sigma =
    history.length > 1
      ? Math.sqrt(
          history
            .slice(1)
            .map((p, i) => (p.quantity - history[i].quantity) ** 2)
            .reduce((s, x) => s + x, 0) /
            (history.length - 1),
        )
      : 1;
  return {
    sku_id: sku,
    segment: segment as "food_service" | "healthcare",
    sigma,
    points: [
      ...history.map((p) => ({
        date: p.date,
        actual: p.quantity,
        forecast: null,
        lower: null,
        upper: null,
      })),
      ...fc.map((p) => ({
        date: p.date,
        actual: null,
        forecast: p.predicted,
        lower: p.lower_ci,
        upper: p.upper_ci,
      })),
    ],
  };
}

export async function loadForecast(sku: string, segment: string): Promise<{ panel: ForecastPanel | null; source: Source }> {
  const live = await liveForecast(sku, segment);
  if (live) return { panel: live, source: "supabase" };
  const panels = await readJson<ForecastPanel[]>("forecasts.json");
  const panel = panels.find((p) => p.sku_id === sku && p.segment === segment) ?? null;
  return { panel, source: "snapshot" };
}

export async function loadAllForecasts(): Promise<{ panels: ForecastPanel[]; source: Source }> {
  if (isSupabaseConfigured()) {
    const client = getServerClient()!;
    const { data: skus } = await client.from("skus").select("sku_id");
    if (skus && skus.length) {
      const panels: ForecastPanel[] = [];
      for (const s of skus as { sku_id: string }[]) {
        for (const seg of ["food_service", "healthcare"]) {
          const live = await liveForecast(s.sku_id, seg);
          if (live) panels.push(live);
        }
      }
      if (panels.length) return { panels, source: "supabase" };
    }
  }
  const panels = await readJson<ForecastPanel[]>("forecasts.json");
  return { panels, source: "snapshot" };
}

// ---------- ANOMALIES ----------
export async function loadAnomalies(): Promise<{ rows: AnomalyRow[]; source: Source }> {
  if (isSupabaseConfigured()) {
    const client = getServerClient()!;
    const { data, error } = await client
      .from("anomalies")
      .select("*")
      .order("detected_at", { ascending: false })
      .limit(200);
    if (!error && data) {
      const rows: AnomalyRow[] = (data as Array<{
        sku: string;
        segment: "food_service" | "healthcare";
        order_date: string;
        anomaly_type: "surge" | "shortfall";
        severity: number;
        description: string | null;
      }>).map((a) => ({
        sku_id: a.sku,
        segment: a.segment,
        order_date: a.order_date,
        units_actual: 0,
        units_pred: 0,
        residual: 0,
        z: Number(a.severity),
        direction: a.anomaly_type,
      }));
      if (rows.length) return { rows, source: "supabase" };
    }
  }
  const rows = await readJson<AnomalyRow[]>("anomalies.json");
  return { rows, source: "snapshot" };
}

// ---------- SLOW MOVERS, REV, LEADERBOARD, WINNERS, DQ ----------
export async function loadSlowMovers(): Promise<SlowMoverRow[]> {
  // For snapshot we use static; live could be added later. Snapshot stays consistent.
  return readJson<SlowMoverRow[]>("slow_movers.json");
}

export async function loadRevenueConcentration(): Promise<RevenueShare[]> {
  if (isSupabaseConfigured()) {
    const from = isoDaysAgo(90);
    const data = await pageOrders({
      columns: "sku,quantity,unit_price,order_date",
      fromDate: from,
    });
    if (data.length) {
      const m = new Map<string, number>();
      for (const o of data) {
        m.set(o.sku as string, (m.get(o.sku as string) ?? 0) + Number(o.quantity) * Number(o.unit_price));
      }
      const total = Array.from(m.values()).reduce((s, x) => s + x, 0) || 1;
      const arr = Array.from(m.entries())
        .map(([sku_id, revenue]) => ({ sku_id, revenue, share: revenue / total, cumulative_share: 0 }))
        .sort((a, b) => b.revenue - a.revenue);
      let cum = 0;
      for (const r of arr) {
        cum += r.share;
        r.cumulative_share = cum;
      }
      return arr;
    }
  }
  return readJson<RevenueShare[]>("revenue_concentration.json");
}

export async function loadLeaderboard(): Promise<LeaderboardEntry[]> {
  return readJson<LeaderboardEntry[]>("leaderboard.json");
}

export async function loadWinners(): Promise<Winner[]> {
  return readJson<Winner[]>("winners.json");
}

export async function loadDataQuality(): Promise<DataQuality> {
  return readJson<DataQuality>("data_quality.json");
}
