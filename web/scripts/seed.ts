/**
 * Seed StockSense Supabase tables with realistic synthetic order history.
 *
 * Mirrors the Python pipeline's generator: 12 SKUs × 2 segments × ~18 months
 * of daily orders, with weekly + yearly seasonality, four promo windows, and a
 * planted glove supply-shock episode in September.
 *
 * Run:
 *   cd web
 *   npx tsx scripts/seed.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Truncates orders + inventory before inserting (skus is left intact).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

type Sku = {
  sku_id: string;
  primary_segment: "food_service" | "healthcare";
  unit_cost: number;
  lead_time_days: number;
  demand_scale: number;
  seasonality_pattern: "food_service" | "healthcare";
};

const CATALOG: Sku[] = [
  { sku_id: "GLV-NIT-M", primary_segment: "healthcare", unit_cost: 32.5, lead_time_days: 7, demand_scale: 1.4, seasonality_pattern: "healthcare" },
  { sku_id: "GLV-NIT-L", primary_segment: "healthcare", unit_cost: 32.5, lead_time_days: 7, demand_scale: 1.2, seasonality_pattern: "healthcare" },
  { sku_id: "GLV-VIN-M", primary_segment: "food_service", unit_cost: 21.0, lead_time_days: 10, demand_scale: 1.6, seasonality_pattern: "food_service" },
  { sku_id: "GLV-POL-L", primary_segment: "food_service", unit_cost: 8.4, lead_time_days: 14, demand_scale: 1.0, seasonality_pattern: "food_service" },
  { sku_id: "WRP-FOIL-18", primary_segment: "food_service", unit_cost: 18.2, lead_time_days: 14, demand_scale: 0.9, seasonality_pattern: "food_service" },
  { sku_id: "WRP-PLAS-12", primary_segment: "food_service", unit_cost: 12.95, lead_time_days: 14, demand_scale: 0.8, seasonality_pattern: "food_service" },
  { sku_id: "CTR-8OZ", primary_segment: "food_service", unit_cost: 28.0, lead_time_days: 14, demand_scale: 1.1, seasonality_pattern: "food_service" },
  { sku_id: "CTR-32OZ", primary_segment: "food_service", unit_cost: 64.0, lead_time_days: 14, demand_scale: 0.7, seasonality_pattern: "food_service" },
  { sku_id: "CUT-FRK", primary_segment: "food_service", unit_cost: 14.5, lead_time_days: 21, demand_scale: 1.3, seasonality_pattern: "food_service" },
  { sku_id: "CUT-KIT", primary_segment: "food_service", unit_cost: 32.75, lead_time_days: 21, demand_scale: 0.6, seasonality_pattern: "food_service" },
  { sku_id: "PRT-2OZ", primary_segment: "food_service", unit_cost: 22.0, lead_time_days: 14, demand_scale: 1.0, seasonality_pattern: "food_service" },
  { sku_id: "MED-GAU-4", primary_segment: "healthcare", unit_cost: 18.5, lead_time_days: 10, demand_scale: 0.5, seasonality_pattern: "healthcare" },
];

const SEGMENTS: ("food_service" | "healthcare")[] = ["food_service", "healthcare"];

const PROMO_WINDOWS: Array<[string, string, string[]]> = [
  ["2024-04-15", "2024-04-28", ["WRP-FOIL-18", "WRP-PLAS-12"]],
  ["2024-07-01", "2024-07-14", ["CTR-32OZ", "CUT-KIT"]],
  ["2024-11-25", "2024-12-08", ["GLV-NIT-M", "GLV-NIT-L"]],
  ["2025-03-10", "2025-03-24", ["CUT-FRK", "PRT-2OZ"]],
];
const SUPPLY_SHOCK: [string, string, string[]] = [
  "2024-09-05",
  "2024-09-23",
  ["GLV-NIT-M", "GLV-NIT-L"],
];

const BASE_FOOD_SERVICE = 80;
const BASE_HEALTHCARE = 55;
const PROMO_LIFT = 0.45;
const SHOCK_DROP = 0.65;
const NOISE_SIGMA = 0.18;

function* daterange(start: string, end: string) {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    yield d.toISOString().slice(0, 10);
  }
}

function dayOfYear(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

function dayOfWeek(iso: string): number {
  return new Date(iso + "T00:00:00Z").getUTCDay() === 0 ? 6 : new Date(iso + "T00:00:00Z").getUTCDay() - 1;
}

function seasonal(d: string, pattern: string): number {
  const doy = dayOfYear(d);
  const phase = (2 * Math.PI * doy) / 365.0;
  if (pattern === "food_service") {
    const summer = 0.2 * Math.sin(phase - Math.PI / 2);
    const holiday1 = 0.18 * Math.exp(-((doy - 350) ** 2) / 200);
    const holiday2 = 0.18 * Math.exp(-((doy - 15) ** 2) / 200);
    return 1.0 + summer + holiday1 + holiday2;
  }
  if (pattern === "healthcare") {
    const flu = 0.28 * (0.5 * Math.cos(phase) + 0.5);
    return 0.85 + flu;
  }
  return 1.0;
}

function weekly(d: string, segment: string): number {
  const dow = dayOfWeek(d);
  const fs = [0.95, 1.0, 1.05, 1.05, 1.2, 1.4, 1.3];
  const hc = [1.2, 1.18, 1.15, 1.12, 1.08, 0.65, 0.5];
  return (segment === "food_service" ? fs : hc)[dow];
}

function inWindow(d: string, s: string, e: string): boolean {
  return d >= s && d <= e;
}

function isPromo(d: string, sku: string): boolean {
  return PROMO_WINDOWS.some(([s, e, skus]) => inWindow(d, s, e) && skus.includes(sku));
}

function isShock(d: string, sku: string): boolean {
  const [s, e, skus] = SUPPLY_SHOCK;
  return inWindow(d, s, e) && skus.includes(sku);
}

// Box-Muller for deterministic normal noise
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function normal(rng: () => number, mu: number, sigma: number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mu + sigma * z;
}

type OrderRow = {
  sku: string;
  segment: "food_service" | "healthcare";
  quantity: number;
  unit_price: number;
  order_date: string;
};

function generate(start: string, end: string): OrderRow[] {
  const rng = makeRng(42);
  const out: OrderRow[] = [];
  for (const sku of CATALOG) {
    for (const segment of SEGMENTS) {
      let base = segment === "food_service" ? BASE_FOOD_SERVICE : BASE_HEALTHCARE;
      base *= segment === sku.primary_segment ? 1.0 : 0.35;
      base *= sku.demand_scale;
      for (const d of daterange(start, end)) {
        const s = seasonal(d, sku.seasonality_pattern);
        const w = weekly(d, segment);
        const promo = isPromo(d, sku.sku_id) ? PROMO_LIFT : 0;
        const shock = isShock(d, sku.sku_id) ? -SHOCK_DROP : 0;
        const mu = Math.log(Math.max(base * s * w, 1.0)) + Math.log1p(promo) + Math.log1p(shock);
        const units = Math.max(0, Math.exp(normal(rng, mu, NOISE_SIGMA)));
        out.push({
          sku: sku.sku_id,
          segment,
          quantity: Math.round(units * 100) / 100,
          unit_price: Math.round(sku.unit_cost * 1.35 * 100) / 100,
          order_date: d,
        });
      }
    }
  }
  return out;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log("Truncating orders, inventory, and anomalies…");
  await supabase.from("anomalies").delete().neq("id", -1);
  await supabase.from("orders").delete().neq("id", -1);
  await supabase.from("inventory").delete().neq("id", -1);

  // 18 months of history ending today so "last 30 days" KPIs have data.
  const end = isoDaysAgo(0);
  const start = isoDaysAgo(547);
  console.log(`Generating order history ${start} → ${end}…`);
  const rows = generate(start, end);
  console.log(`Generated ${rows.length} rows. Inserting in batches…`);

  // Disable the anomaly trigger during bulk seed so we don't burn it on every row
  // (requires running via a stored procedure or temporarily dropping the trigger).
  // Simpler: just insert and accept the per-row trigger cost.
  const batchSize = 1000;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from("orders").insert(batch);
    if (error) {
      console.error(`Batch ${i / batchSize}: ${error.message}`);
      process.exit(1);
    }
    inserted += batch.length;
    if ((i / batchSize) % 5 === 0) {
      process.stdout.write(`  ${inserted}/${rows.length}\r`);
    }
  }
  console.log(`Inserted ${inserted} orders.`);

  console.log("Computing inventory snapshots…");
  // Build per-panel average over last 14 days
  const cutoff = isoDaysAgo(13);
  const recent = rows.filter((r) => r.order_date >= cutoff);
  const byPanel = new Map<string, number[]>();
  for (const r of recent) {
    const k = `${r.sku}__${r.segment}`;
    if (!byPanel.has(k)) byPanel.set(k, []);
    byPanel.get(k)!.push(r.quantity);
  }
  const invRng = makeRng(7);
  const inventory: Array<{
    sku: string;
    segment: "food_service" | "healthcare";
    on_hand: number;
    lead_time_days: number;
    reorder_point: number;
  }> = [];
  for (const sku of CATALOG) {
    for (const segment of SEGMENTS) {
      const k = `${sku.sku_id}__${segment}`;
      const qs = byPanel.get(k) ?? [];
      const avg = qs.length ? qs.reduce((s, q) => s + q, 0) / qs.length : 10;
      const multiplier = 4 + invRng() * 18;
      const onHand = Math.round(avg * multiplier);
      inventory.push({
        sku: sku.sku_id,
        segment,
        on_hand: onHand,
        lead_time_days: sku.lead_time_days,
        reorder_point: Math.round(avg * sku.lead_time_days * 1.2),
      });
    }
  }
  const { error: invErr } = await supabase.from("inventory").insert(inventory);
  if (invErr) {
    console.error(invErr.message);
    process.exit(1);
  }
  console.log(`Inserted ${inventory.length} inventory snapshots.`);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
