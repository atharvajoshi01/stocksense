/**
 * Forecasting engine.
 *
 * Three models:
 *  - seasonalNaive7: y_hat(t) = y(t - 7)
 *  - linearTrend:    OLS regression on last 30 daily points
 *  - ensemble:       0.6 * seasonal + 0.4 * trend
 *
 * All work on { date: string ISO yyyy-mm-dd, quantity: number } daily series
 * sorted ascending. Output is a 14-day forecast with 95% confidence bands.
 */

export type DailyPoint = { date: string; quantity: number };
export type ForecastPoint = {
  date: string;
  predicted: number;
  lower_ci: number;
  upper_ci: number;
  model: string;
};

const HORIZON = 14;
const Z95 = 1.96;

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

function residualStd(history: DailyPoint[]): number {
  // Use stddev of the diff series as a rough residual estimator
  const q = history.map((p) => p.quantity);
  const diffs: number[] = [];
  for (let i = 1; i < q.length; i++) diffs.push(q[i] - q[i - 1]);
  return stddev(diffs) || 1;
}

export function seasonalNaive7(history: DailyPoint[], horizon = HORIZON): number[] {
  const out: number[] = [];
  if (!history.length) return new Array(horizon).fill(0);
  const last = history[history.length - 1];
  for (let h = 1; h <= horizon; h++) {
    const target = addDays(last.date, h);
    // Find the same weekday from one week earlier
    const sourceDate = addDays(target, -7);
    const hit = history.find((p) => p.date === sourceDate);
    if (hit) {
      out.push(Math.max(0, hit.quantity));
    } else {
      // Fall back to grand mean
      out.push(Math.max(0, mean(history.map((p) => p.quantity))));
    }
  }
  return out;
}

export function linearTrend(history: DailyPoint[], horizon = HORIZON): number[] {
  const window = history.slice(-30);
  const n = window.length;
  if (n < 2) {
    const m = mean(window.map((p) => p.quantity));
    return new Array(horizon).fill(Math.max(0, m));
  }
  // OLS y = a + b * x where x is day index 0..n-1
  const ys = window.map((p) => p.quantity);
  const xs = Array.from({ length: n }, (_, i) => i);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const b = den === 0 ? 0 : num / den;
  const a = my - b * mx;
  const out: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const x = n - 1 + h;
    out.push(Math.max(0, a + b * x));
  }
  return out;
}

export function ensemble(history: DailyPoint[], horizon = HORIZON): number[] {
  const sn = seasonalNaive7(history, horizon);
  const lt = linearTrend(history, horizon);
  const out: number[] = [];
  for (let i = 0; i < horizon; i++) {
    out.push(Math.max(0, 0.6 * sn[i] + 0.4 * lt[i]));
  }
  return out;
}

export function forecast14d(
  history: DailyPoint[],
  model: "seasonal_naive" | "linear_trend" | "ensemble" = "ensemble",
  horizon = HORIZON,
): ForecastPoint[] {
  if (!history.length) return [];
  const fn =
    model === "seasonal_naive"
      ? seasonalNaive7
      : model === "linear_trend"
        ? linearTrend
        : ensemble;
  const point = fn(history, horizon);
  const sigma = residualStd(history);
  const last = history[history.length - 1].date;
  return point.map((p, i) => ({
    date: addDays(last, i + 1),
    predicted: round2(p),
    lower_ci: round2(Math.max(0, p - Z95 * sigma * Math.sqrt(i + 1))),
    upper_ci: round2(p + Z95 * sigma * Math.sqrt(i + 1)),
    model,
  }));
}

export function computeMAPE(actual: number[], predicted: number[]): number {
  if (actual.length !== predicted.length || !actual.length) return NaN;
  let s = 0;
  let n = 0;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] > 0) {
      s += Math.abs((actual[i] - predicted[i]) / actual[i]);
      n++;
    }
  }
  return n ? s / n : NaN;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
