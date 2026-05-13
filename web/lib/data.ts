import fs from "fs/promises";
import path from "path";

export type SkuMeta = {
  sku_id: string;
  name: string;
  product_family: string;
  primary_segment: "food_service" | "healthcare";
  lead_time_days: number;
  case_pack: number;
  unit_cost: number;
};

export type Meta = {
  generated_at: string;
  start_date: string;
  end_date: string;
  n_orders: number;
  n_skus: number;
  n_segments: number;
  catalog: SkuMeta[];
};

export type Kpis = {
  revenue_last_30d: number;
  revenue_prior_30d: number;
  revenue_change_pct: number | null;
  units_last_30d: number;
  forecast_mape: number;
  forecast_bias: number;
  high_risk_skus: number;
  decelerating_skus: number;
  accelerating_skus: number;
};

export type Winner = { sku_id: string; segment: string; winner: string };

export type LeaderboardEntry = {
  forecaster: string;
  overall: { mape: number; rmse: number; bias: number; n: number };
  per_sku: Array<{ sku_id: string; segment: string; mape: number | null; rmse: number; bias: number; n: number }>;
};

export type ForecastPoint = {
  date: string;
  actual: number | null;
  forecast: number | null;
  lower: number | null;
  upper: number | null;
};

export type ForecastSeries = {
  sku_id: string;
  segment: string;
  sigma: number;
  points: ForecastPoint[];
};

export type InventoryRow = {
  sku_id: string;
  segment: string;
  units_on_hand: number;
  avg_daily_forecast: number;
  days_of_cover: number;
  projected_stockout_days: number;
  lead_time_days: number;
  stockout_risk: "low" | "medium" | "high";
};

export type SlowMoverRow = {
  sku_id: string;
  segment: string;
  baseline_daily: number;
  recent_daily: number;
  delta_pct: number | null;
  movement: "accelerating" | "stable" | "decelerating";
};

export type AnomalyRow = {
  sku_id: string;
  segment: string;
  order_date: string;
  units_actual: number;
  units_pred: number;
  residual: number;
  z: number;
  direction: "surge" | "shortfall";
};

export type RevenueShare = {
  sku_id: string;
  revenue: number;
  share: number;
  cumulative_share: number;
};

export type DataQuality = {
  passed: boolean;
  n_findings: number;
  n_failed: number;
  findings: Array<{ name: string; passed: boolean; detail: string; offending_rows: number }>;
};

const DATA_DIR = path.join(process.cwd(), "public", "data");

async function readJson<T>(file: string): Promise<T> {
  const raw = await fs.readFile(path.join(DATA_DIR, file), "utf-8");
  return JSON.parse(raw) as T;
}

export const loadMeta = () => readJson<Meta>("meta.json");
export const loadKpis = () => readJson<Kpis>("kpis.json");
export const loadWinners = () => readJson<Winner[]>("winners.json");
export const loadLeaderboard = () => readJson<LeaderboardEntry[]>("leaderboard.json");
export const loadForecasts = () => readJson<ForecastSeries[]>("forecasts.json");
export const loadInventory = () => readJson<InventoryRow[]>("inventory.json");
export const loadSlowMovers = () => readJson<SlowMoverRow[]>("slow_movers.json");
export const loadAnomalies = () => readJson<AnomalyRow[]>("anomalies.json");
export const loadRevenueConcentration = () => readJson<RevenueShare[]>("revenue_concentration.json");
export const loadDataQuality = () => readJson<DataQuality>("data_quality.json");

export function panelKey(sku_id: string, segment: string): string {
  return `${sku_id}__${segment}`;
}
