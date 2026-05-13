/**
 * Anomaly detection: rolling 14-day z-score on quantity.
 *
 * The DB also has a trigger that runs the same logic on insert (see
 * supabase/schema.sql). This module is used by the /api/anomalies route to
 * back-compute on the existing series, and by the seed script.
 */

import type { DailyPoint } from "./forecasting";

export type AnomalyResult = {
  date: string;
  quantity: number;
  rolling_mean: number;
  rolling_std: number;
  z: number;
  direction: "surge" | "shortfall";
};

export function detectAnomalies(
  history: DailyPoint[],
  threshold = 2.5,
  window = 14,
): AnomalyResult[] {
  const out: AnomalyResult[] = [];
  for (let i = window; i < history.length; i++) {
    const slice = history.slice(i - window, i).map((p) => p.quantity);
    const m = mean(slice);
    const s = std(slice);
    if (s === 0) continue;
    const q = history[i].quantity;
    const z = (q - m) / s;
    if (Math.abs(z) >= threshold) {
      out.push({
        date: history[i].date,
        quantity: q,
        rolling_mean: m,
        rolling_std: s,
        z,
        direction: z > 0 ? "surge" : "shortfall",
      });
    }
  }
  return out;
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}
